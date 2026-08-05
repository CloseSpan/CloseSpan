import type { ExecutionProfileAssignmentView } from "./execution-profile-repository";
import type { ProblemRepositoryMatchView } from "./execution-profile";
import type { GithubRepositoryAuthorization } from "./github-repository-allowlist";
import type {
  ConfirmProblemRepositoryMatchResult,
  ProblemRepositoryMatchRefreshResult,
} from "./problem-repository-match-repository";

export interface ProblemRepositoryMatchReviewView {
  available: boolean;
  canReview: boolean;
  canRefreshDetection: boolean;
  repositories: GithubRepositoryAuthorization[];
  assignments: ExecutionProfileAssignmentView[];
  matches: ProblemRepositoryMatchView[];
  confirmedMatch: ProblemRepositoryMatchView | null;
  pddProfileReady: boolean;
  refresh: ProblemRepositoryMatchRefreshResult | null;
}

export interface ProblemRepositoryMatchReviewResponse
  extends ProblemRepositoryMatchReviewView {
  confirmation?: ConfirmProblemRepositoryMatchResult;
  rejectedMatch?: ProblemRepositoryMatchView;
  error?: string;
}
