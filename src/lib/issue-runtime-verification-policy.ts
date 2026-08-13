export const ISSUE_RUNTIME_VERIFICATION_QUEUE_TIMEOUT_MS = 15 * 60_000;
export const ISSUE_RUNTIME_VERIFICATION_RUNNING_TIMEOUT_MS = 80 * 60_000;
export const ISSUE_RUNTIME_VERIFICATION_JOB_TTL_MS =
  ISSUE_RUNTIME_VERIFICATION_QUEUE_TIMEOUT_MS
  + ISSUE_RUNTIME_VERIFICATION_RUNNING_TIMEOUT_MS;

export const ISSUE_RUNTIME_VERIFICATION_QUEUE_TIMEOUT_MESSAGE =
  "Tenki did not start this verification within 15 minutes. Confirm the runner is online, then retry.";
export const ISSUE_RUNTIME_VERIFICATION_RUNNING_TIMEOUT_MESSAGE =
  "Tenki did not return runtime evidence within 80 minutes of starting. Review the GitHub run, then retry.";
