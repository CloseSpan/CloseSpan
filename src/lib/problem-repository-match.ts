const unresolvedRepositoryLabels = new Set([
  "",
  "not yet identified",
  "not identified",
  "unknown",
  "tbd",
  "n/a",
  "none",
]);

const genericRepositoryTokens = new Set([
  "app",
  "application",
  "backend",
  "client",
  "code",
  "frontend",
  "main",
  "platform",
  "repo",
  "repository",
  "server",
  "service",
  "web",
]);

export interface ProblemRepositoryEvidence {
  suspectedRepository: string;
  suspectedFiles: string[];
  title: string;
  statement: string;
  summary: string;
  productArea: string;
  team: string;
}

export interface RepositoryMatchCandidate {
  repository: string;
  defaultBranch: string;
  workspaceRoots?: string[];
  manifestSignals?: string[];
}

export interface RankedRepositoryMatch extends RepositoryMatchCandidate {
  confidence: number;
  reasons: string[];
}

export interface ProblemRepositoryResolution {
  selected: RankedRepositoryMatch | null;
  ranked: RankedRepositoryMatch[];
  needsReview: boolean;
  reason: string;
}

export const PROBLEM_REPOSITORY_AUTO_MATCH_THRESHOLD = 0.68;
export const PROBLEM_REPOSITORY_AUTO_MATCH_MARGIN = 0.12;

function normalized(value: string): string {
  return value.trim().toLowerCase().replaceAll("\\", "/");
}

export function isUnresolvedRepositoryLabel(value: string): boolean {
  return unresolvedRepositoryLabels.has(normalized(value));
}

function tokenize(value: string): Set<string> {
  const expanded = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  return new Set(
    expanded
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !genericRepositoryTokens.has(token)),
  );
}

function repositoryTokens(repository: string): Set<string> {
  const [, name = repository] = repository.split("/");
  return tokenize(name);
}

function overlap(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let matches = 0;
  for (const token of left) if (right.has(token)) matches += 1;
  return matches / left.size;
}

function bounded(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 1_000) / 1_000;
}

function scoreCandidate(
  evidence: ProblemRepositoryEvidence,
  candidate: RepositoryMatchCandidate,
): RankedRepositoryMatch {
  const candidateRepository = normalized(candidate.repository);
  const suspectedRepository = normalized(evidence.suspectedRepository);
  if (
    !isUnresolvedRepositoryLabel(evidence.suspectedRepository) &&
    candidateRepository === suspectedRepository
  ) {
    return {
      ...candidate,
      confidence: 1,
      reasons: ["The problem names this authorized repository exactly."],
    };
  }

  const repoTokens = repositoryTokens(candidate.repository);
  const fileText = evidence.suspectedFiles.join(" ");
  const ownershipText = `${evidence.productArea} ${evidence.team}`;
  const problemText = `${evidence.title} ${evidence.statement} ${evidence.summary}`;
  const manifestText = [
    ...(candidate.workspaceRoots ?? []),
    ...(candidate.manifestSignals ?? []),
  ].join(" ");

  const fileOverlap = overlap(repoTokens, tokenize(fileText));
  const ownershipOverlap = overlap(repoTokens, tokenize(ownershipText));
  const problemOverlap = overlap(repoTokens, tokenize(problemText));
  const manifestOverlap = overlap(tokenize(manifestText), tokenize(`${fileText} ${ownershipText} ${problemText}`));
  const reasons: string[] = [];
  let confidence = 0;

  if (fileOverlap > 0) {
    confidence += 0.52 * fileOverlap;
    reasons.push("Suspected file paths overlap the repository name.");
  }
  if (ownershipOverlap > 0) {
    confidence += 0.24 * ownershipOverlap;
    reasons.push("Product area or owning team overlaps the repository name.");
  }
  if (problemOverlap > 0) {
    confidence += 0.16 * problemOverlap;
    reasons.push("The problem description overlaps the repository name.");
  }
  if (manifestOverlap > 0) {
    confidence += 0.08 * manifestOverlap;
    reasons.push("Detected workspace metadata overlaps the problem evidence.");
  }

  return {
    ...candidate,
    confidence: bounded(confidence),
    reasons,
  };
}

/**
 * Selects a repository only when the evidence is deterministic or sufficiently
 * strong and unambiguous. Ambiguous results remain reviewable suggestions and
 * never silently become executable repository context.
 */
export function resolveProblemRepository(
  evidence: ProblemRepositoryEvidence,
  candidates: RepositoryMatchCandidate[],
): ProblemRepositoryResolution {
  const authorized = candidates.filter((candidate) =>
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(candidate.repository.trim()),
  );
  if (!authorized.length) {
    return {
      selected: null,
      ranked: [],
      needsReview: true,
      reason: "No active GitHub repository is authorized for this workspace.",
    };
  }

  const exact = !isUnresolvedRepositoryLabel(evidence.suspectedRepository)
    ? authorized.find(
        (candidate) => normalized(candidate.repository) === normalized(evidence.suspectedRepository),
      )
    : undefined;
  if (exact) {
    const selected = scoreCandidate(evidence, exact);
    return {
      selected,
      ranked: [selected],
      needsReview: false,
      reason: "The problem already names an authorized repository.",
    };
  }

  if (authorized.length === 1) {
    const selected: RankedRepositoryMatch = {
      ...authorized[0],
      confidence: 0.95,
      reasons: ["This is the workspace's only active authorized repository."],
    };
    return {
      selected,
      ranked: [selected],
      needsReview: false,
      reason: "The only authorized repository was selected.",
    };
  }

  const ranked = authorized
    .map((candidate) => scoreCandidate(evidence, candidate))
    .sort(
      (left, right) =>
        right.confidence - left.confidence || left.repository.localeCompare(right.repository),
    );
  const best = ranked[0];
  const runnerUp = ranked[1];
  if (
    best.confidence >= PROBLEM_REPOSITORY_AUTO_MATCH_THRESHOLD &&
    best.confidence - runnerUp.confidence >= PROBLEM_REPOSITORY_AUTO_MATCH_MARGIN
  ) {
    return {
      selected: best,
      ranked,
      needsReview: false,
      reason: "Repository evidence passed the confidence and ambiguity thresholds.",
    };
  }

  return {
    selected: null,
    ranked,
    needsReview: true,
    reason:
      best.confidence < PROBLEM_REPOSITORY_AUTO_MATCH_THRESHOLD
        ? "Repository evidence is below the automatic-selection threshold."
        : "The leading repository match is too close to the next candidate.",
  };
}
