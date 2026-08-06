import type {
  ProcessRunHandle,
  ProcessRunResult,
  Session,
} from "@tenkicloud/sandbox";

export interface TenkiHostCommandOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs: number;
  terminationGraceMs?: number;
}

export interface TenkiHostCommandResult extends ProcessRunResult {
  timedOut: boolean;
}

type RunSession = Pick<Session, "run">;

const DESCENDANT_POLL_INTERVAL_MS = 50;
const PROCESS_GROUP_SUPERVISOR_ARGV0 = "tenki-host-command-supervisor";

/**
 * Run the requested command in a new process group. The supervisor owns that
 * group and, when the host sends TERM, forwards TERM to every descendant before
 * escalating the whole group to KILL. It also removes daemonized descendants
 * when the command's process exits normally.
 */
const PROCESS_GROUP_SUPERVISOR_SOURCE = String.raw`
set -u
descendant_attempts="$1"
shift
child_pid=""
pending_shutdown_status=0

group_exists() {
  [ -n "$child_pid" ] && kill -0 -- "-$child_pid" 2>/dev/null
}

signal_group() {
  kill "-$1" -- "-$child_pid" 2>/dev/null || true
}

cleanup_group() {
  if group_exists; then
    signal_group TERM
    attempt=0
    while group_exists && [ "$attempt" -lt "$descendant_attempts" ]; do
      sleep 0.05
      attempt=$((attempt + 1))
    done
    if group_exists; then
      signal_group KILL
    fi
  fi
  wait "$child_pid" 2>/dev/null || true
}

shutdown_group() {
  status="$1"
  trap - TERM INT
  cleanup_group
  exit "$status"
}

request_shutdown() {
  pending_shutdown_status="$1"
  if [ -n "$child_pid" ]; then
    shutdown_group "$pending_shutdown_status"
  fi
}

# Install traps before launching the child. If TERM arrives in the small window
# before $! is assigned, remember it and clean up immediately after assignment.
trap 'request_shutdown 143' TERM
trap 'request_shutdown 130' INT
setsid -- "$@" &
child_pid=$!
if [ "$pending_shutdown_status" -ne 0 ]; then
  shutdown_group "$pending_shutdown_status"
fi
set +e
wait "$child_pid"
status=$?
set -e
trap - TERM INT
cleanup_group
exit "$status"
`;

function processGroupSupervisorArgv(
  argv: readonly [string, ...string[]],
  terminationGraceMs: number,
): [string, ...string[]] {
  // Finish the descendant escalation before the host-side KILL deadline. A
  // very short grace period intentionally escalates the child group at once.
  const descendantAttempts = Math.floor(
    terminationGraceMs / (DESCENDANT_POLL_INTERVAL_MS * 2),
  );
  return [
    "bash",
    "-c",
    PROCESS_GROUP_SUPERVISOR_SOURCE,
    PROCESS_GROUP_SUPERVISOR_ARGV0,
    String(descendantAttempts),
    ...argv,
  ];
}

async function settleWithin<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<{ settled: true; value: T } | { settled: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then((value) => ({ settled: true as const, value })),
      new Promise<{ settled: false }>((resolve) => {
        timer = setTimeout(() => resolve({ settled: false }), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function terminateBoundedProcess(
  handle: ProcessRunHandle,
  completion: Promise<ProcessRunResult>,
  graceMs: number,
): Promise<ProcessRunResult> {
  await handle.signal("TERM").catch(() => undefined);
  const graceful = await settleWithin(completion, graceMs);
  if (graceful.settled) return graceful.value;
  await handle.kill().catch(() => undefined);
  const forced = await settleWithin(completion, graceMs);
  if (forced.settled) return forced.value;
  throw new Error("Tenki command did not terminate after KILL");
}

/**
 * Session.exec in older Tenki SDKs does not enforce timeoutMs. This wrapper
 * owns the deadline in the host process and always attempts TERM then KILL.
 */
export async function runTenkiHostCommand(
  session: RunSession,
  argv: readonly [string, ...string[]],
  options: TenkiHostCommandOptions,
): Promise<TenkiHostCommandResult> {
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1) {
    throw new Error("Tenki command timeout must be a positive integer");
  }
  const graceMs = options.terminationGraceMs ?? 5_000;
  if (!Number.isInteger(graceMs) || graceMs < 1) {
    throw new Error("Tenki command termination grace must be a positive integer");
  }
  const handle = session.run(processGroupSupervisorArgv(argv, graceMs), {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.env ? { env: options.env } : {}),
  });
  const completion = Promise.resolve(handle);
  const result = await settleWithin(completion, options.timeoutMs);
  if (result.settled) return { ...result.value, timedOut: false };
  const terminated = await terminateBoundedProcess(handle, completion, graceMs);
  const timeoutMessage = new TextEncoder().encode(
    `Command exceeded its ${options.timeoutMs}ms host-side timeout.`,
  );
  return {
    ...terminated,
    exitCode: terminated.exitCode === 0 ? 124 : terminated.exitCode,
    stderr: terminated.stderr.byteLength
      ? terminated.stderr
      : timeoutMessage,
    timedOut: true,
  };
}
