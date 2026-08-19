export const ISSUE_RUNTIME_VERIFICATION_QUEUE_TIMEOUT_MS = 5 * 60_000;
export const ISSUE_RUNTIME_VERIFICATION_RUNNING_TIMEOUT_MS = 80 * 60_000;
export const ISSUE_RUNTIME_VERIFICATION_JOB_TTL_MS =
  ISSUE_RUNTIME_VERIFICATION_QUEUE_TIMEOUT_MS
  + ISSUE_RUNTIME_VERIFICATION_RUNNING_TIMEOUT_MS;

export const ISSUE_RUNTIME_VERIFICATION_QUEUE_TIMEOUT_MESSAGE =
  "Runner unavailable. Tenki did not assign the configured verification runner within 5 minutes, so CloseSpan stopped the verification and requested cancellation of its GitHub workflow. Confirm the runner is available, then retry.";
export const ISSUE_RUNTIME_VERIFICATION_RUNNING_TIMEOUT_MESSAGE =
  "Tenki did not return runtime evidence within 80 minutes of starting. Review the GitHub run, then retry.";
