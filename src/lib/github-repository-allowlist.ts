import { databasePool } from "./db";
import { createGithubInstallationClient } from "./github-app-auth";
import { HttpError } from "./request-security";
import { workspacePersistenceMode } from "./workspace-persistence";

export interface GithubRepositoryAuthorization {
  id: string;
  installationId: string;
  repository: string;
  defaultBranch: string;
  executionBranch: string;
  workspaceSelected: boolean;
  active: boolean;
}

export interface GithubAuthorizedBranchHead {
  repository: string;
  branch: string;
  sha: string;
}

export interface GithubAuthorizedBranchList {
  repository: string;
  branches: string[];
  truncated: boolean;
}

interface GithubReferenceClient {
  rest: {
    git: {
      getRef(input: {
        owner: string;
        repo: string;
        ref: string;
      }): Promise<{ data: { object: { sha: string } } }>;
    };
  };
}

interface GithubBranchHeadDependencies {
  listAuthorizations?: (
    orgId: string,
  ) => Promise<GithubRepositoryAuthorization[]>;
  createInstallationClient?: (
    installationId: string,
  ) => Promise<GithubReferenceClient>;
}

interface GithubBranchListingClient {
  rest: {
    repos: {
      listBranches(input: {
        owner: string;
        repo: string;
        per_page: number;
        page: number;
      }): Promise<{ data: Array<{ name: string }> }>;
    };
  };
}

interface GithubBranchListingDependencies {
  listAuthorizations?: (
    orgId: string,
  ) => Promise<GithubRepositoryAuthorization[]>;
  createInstallationClient?: (
    installationId: string,
  ) => Promise<GithubBranchListingClient>;
}

const GITHUB_BRANCH_PAGE_SIZE = 100;
const GITHUB_BRANCH_PAGE_LIMIT = 5;

const memoryAuthorizations = new Map<string, GithubRepositoryAuthorization[]>();

export async function listGithubRepositoryAuthorizations(orgId: string): Promise<GithubRepositoryAuthorization[]> {
  if (workspacePersistenceMode(orgId) === "memory") return structuredClone(memoryAuthorizations.get(orgId) ?? []);
  const result = await databasePool().query<{
    id: string; installation_id: string; repository: string; default_branch: string;
    execution_branch: string;
    workspace_selected: boolean; active: boolean;
  }>(`SELECT id,installation_id::text,repository,default_branch,execution_branch,workspace_selected,active
        FROM github_repository_allowlists WHERE org_id=$1 ORDER BY repository`, [orgId]);
  return result.rows.map((row) => ({ id: row.id, installationId: row.installation_id, repository: row.repository, defaultBranch: row.default_branch, executionBranch: row.execution_branch, workspaceSelected: row.workspace_selected, active: row.active }));
}

export async function resolveAuthorizedGithubBranchHead(
  input: {
    orgId: string;
    repository: string;
    branch?: string;
  },
  dependencies: GithubBranchHeadDependencies = {},
): Promise<GithubAuthorizedBranchHead> {
  const listAuthorizations = dependencies.listAuthorizations
    ?? listGithubRepositoryAuthorizations;
  const authorization = (await listAuthorizations(input.orgId)).find(
    (candidate) => candidate.repository === input.repository
      && candidate.active
      && candidate.workspaceSelected,
  );
  if (!authorization) {
    throw new HttpError(
      409,
      `Repository ${input.repository} is no longer authorized for this workspace`,
    );
  }
  const [owner, repo, ...rest] = input.repository.split("/");
  const selectedBranch = authorization.executionBranch.trim()
    || authorization.defaultBranch.trim();
  const branch = input.branch?.trim() || selectedBranch;
  if (!owner || !repo || rest.length || !branch) {
    throw new HttpError(409, "The approved repository branch is invalid");
  }
  if (branch !== selectedBranch) {
    throw new HttpError(
      409,
      `GitHub branch ${branch} is not the branch selected for ${input.repository}`,
    );
  }
  const github = dependencies.createInstallationClient
    ? await dependencies.createInstallationClient(authorization.installationId)
    : await createGithubInstallationClient(authorization.installationId);
  let sha: string;
  try {
    const ref = await github.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    sha = ref.data.object.sha.toLowerCase();
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && error.status === 404) {
      throw new HttpError(
        409,
        `GitHub branch ${input.repository}:${branch} was not found`,
      );
    }
    throw error;
  }
  if (!/^[a-f0-9]{40}$/.test(sha)) {
    throw new HttpError(409, "GitHub returned an invalid branch commit SHA");
  }
  return { repository: input.repository, branch, sha };
}

export async function listAuthorizedGithubRepositoryBranches(
  input: {
    orgId: string;
    repository: string;
  },
  dependencies: GithubBranchListingDependencies = {},
): Promise<GithubAuthorizedBranchList> {
  const listAuthorizations = dependencies.listAuthorizations
    ?? listGithubRepositoryAuthorizations;
  const authorization = (await listAuthorizations(input.orgId)).find(
    (candidate) => candidate.repository === input.repository
      && candidate.active
      && candidate.workspaceSelected,
  );
  if (!authorization) {
    throw new HttpError(
      409,
      `Repository ${input.repository} is no longer authorized for this workspace`,
    );
  }

  const [owner, repo, ...rest] = input.repository.split("/");
  if (!owner || !repo || rest.length) {
    throw new HttpError(409, "The authorized GitHub repository is invalid");
  }

  const github = dependencies.createInstallationClient
    ? await dependencies.createInstallationClient(authorization.installationId)
    : await createGithubInstallationClient(authorization.installationId);
  const discovered: string[] = [];
  let truncated = false;

  try {
    for (let page = 1; page <= GITHUB_BRANCH_PAGE_LIMIT; page += 1) {
      const response = await github.rest.repos.listBranches({
        owner,
        repo,
        per_page: GITHUB_BRANCH_PAGE_SIZE,
        page,
      });
      discovered.push(...response.data.map((branch) => branch.name.trim()).filter(Boolean));
      if (response.data.length < GITHUB_BRANCH_PAGE_SIZE) break;
      if (page === GITHUB_BRANCH_PAGE_LIMIT) truncated = true;
    }
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && error.status === 404) {
      throw new HttpError(409, `GitHub could not list branches for ${input.repository}`);
    }
    throw error;
  }

  const defaultBranch = authorization.defaultBranch.trim();
  const executionBranch = authorization.executionBranch.trim();
  const priority = new Map(
    [defaultBranch, executionBranch]
      .filter(Boolean)
      .map((branch, index) => [branch, index] as const),
  );
  const branches = [...new Set(discovered)].sort((left, right) => {
    const leftPriority = priority.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = priority.get(right) ?? Number.MAX_SAFE_INTEGER;
    return leftPriority - rightPriority || left.localeCompare(right);
  });

  return { repository: input.repository, branches, truncated };
}

export function normalizeGithubExecutionBranch(value: unknown): string {
  const branch = typeof value === "string" ? value.trim() : "";
  if (
    !branch
    || branch.length > 255
    || branch.startsWith("/")
    || branch.endsWith("/")
    || branch.includes("..")
    || branch.includes("@{")
    || /[\s~^:?*[\]\\\x00-\x1f\x7f]/.test(branch)
  ) throw new HttpError(400, "Choose a valid GitHub execution branch");
  return branch;
}

export async function updateGithubRepositoryExecutionBranch(input: {
  orgId: string;
  repository: string;
  executionBranch: unknown;
}): Promise<string> {
  const executionBranch = normalizeGithubExecutionBranch(input.executionBranch);
  const authorization = (await listGithubRepositoryAuthorizations(input.orgId)).find(
    (candidate) => candidate.repository === input.repository
      && candidate.active
      && candidate.workspaceSelected,
  );
  if (!authorization) throw new HttpError(409, "The repository is no longer authorized");
  const [owner, repo] = input.repository.split("/");
  const github = await createGithubInstallationClient(authorization.installationId);
  try {
    await github.rest.git.getRef({ owner, repo, ref: `heads/${executionBranch}` });
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && error.status === 404) {
      throw new HttpError(400, `GitHub branch ${executionBranch} was not found`);
    }
    throw error;
  }
  await databasePool().query(
    `UPDATE github_repository_allowlists
        SET execution_branch=$3,updated_at=now()
      WHERE org_id=$1 AND repository=$2 AND active=true AND workspace_selected=true`,
    [input.orgId, input.repository, executionBranch],
  );
  return executionBranch;
}
