export interface CompatibleRunnerProbeCandidate {
  label: string;
  cpuCores: number;
  memoryMb: number;
}

export interface RunnerProbeRetryDecision {
  retry: boolean;
  exhausted: boolean;
  nextCandidate: CompatibleRunnerProbeCandidate | null;
  recommendationReasons: string[];
  attemptedCandidateNumber: number | null;
  compatibleCandidateCount: number;
}

function conciseFailure(message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized.length > 320 ? `${normalized.slice(0, 317)}...` : normalized;
}

export function decideCompatibleRunnerProbeRetry(input: {
  currentRunnerLabel: string;
  compatibleCandidates: CompatibleRunnerProbeCandidate[];
  failureCode: string;
  failureMessage: string;
}): RunnerProbeRetryDecision {
  const currentCandidateIndex = input.compatibleCandidates.findIndex(
    (candidate) => candidate.label === input.currentRunnerLabel,
  );
  const attemptedCandidateNumber = currentCandidateIndex >= 0
    ? currentCandidateIndex + 1
    : null;
  const nextCandidate = currentCandidateIndex >= 0
    ? input.compatibleCandidates[currentCandidateIndex + 1] ?? null
    : null;
  const failure = conciseFailure(input.failureMessage);

  if (nextCandidate) {
    return {
      retry: true,
      exhausted: false,
      nextCandidate,
      recommendationReasons: [
        `${input.currentRunnerLabel} failed the compatibility probe (${input.failureCode}): ${failure}`,
        `Retry on verified compatible runner ${nextCandidate.label} (${currentCandidateIndex + 2}/${input.compatibleCandidates.length})`,
      ],
      attemptedCandidateNumber,
      compatibleCandidateCount: input.compatibleCandidates.length,
    };
  }

  const knownCandidate = currentCandidateIndex >= 0;
  return {
    retry: false,
    exhausted: knownCandidate,
    nextCandidate: null,
    recommendationReasons: [
      `${input.currentRunnerLabel} failed the compatibility probe (${input.failureCode}): ${failure}`,
      knownCandidate
        ? `All ${input.compatibleCandidates.length} verified compatible runner candidates have been attempted`
        : "The failed runner was not part of the immutable compatible-candidate set, so CloseSpan refused to select an unapproved alternative",
    ],
    attemptedCandidateNumber,
    compatibleCandidateCount: input.compatibleCandidates.length,
  };
}
