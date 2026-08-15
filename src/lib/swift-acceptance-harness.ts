export const CLOSESPAN_SWIFT_ACCEPTANCE_TEST_PATH =
  "tests/CloseSpanPDDTests.swift";

export const CLOSESPAN_SWIFT_ACCEPTANCE_TEST_COMMAND =
  `swiftc -parse-as-library ${CLOSESPAN_SWIFT_ACCEPTANCE_TEST_PATH} -o /tmp/closespan-pdd-tests && /tmp/closespan-pdd-tests`;

const LEGACY_SWIFT_ACCEPTANCE_TEST_COMMAND =
  `swift ${CLOSESPAN_SWIFT_ACCEPTANCE_TEST_PATH}`;

/**
 * Upgrade already-saved iOS tickets at the execution boundary without changing
 * their immutable prompt or acceptance-test content.
 */
export function normalizeSwiftAcceptanceHarnessCommand(
  command: string,
): string {
  const normalized = command.trim();
  return normalized === LEGACY_SWIFT_ACCEPTANCE_TEST_COMMAND
    ? CLOSESPAN_SWIFT_ACCEPTANCE_TEST_COMMAND
    : normalized;
}
