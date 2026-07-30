import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { HttpError } from "./request-security";

export interface GithubInstallationRepository {
  repository: string;
  defaultBranch: string;
  private: boolean;
}

export interface VerifiedGithubInstallation {
  installationId: string;
  accountId: string;
  accountLogin: string;
  accountType: string;
  repositorySelection: string;
  settingsUrl: string;
  permissions: Record<string, string>;
  repositories: GithubInstallationRepository[];
}

export interface GithubAppClients {
  app?: Octokit;
  installation?: Octokit;
}

export function githubAppConfiguration(): { appId: string; privateKey: string } {
  const appId = process.env.GITHUB_APP_ID?.trim();
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replaceAll("\\n", "\n").trim();
  if (!appId || !privateKey)
    throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required");
  return { appId, privateKey };
}

export function parseGithubInstallationId(value: string): number {
  if (!/^[1-9][0-9]{0,15}$/.test(value))
    throw new HttpError(400, "A valid GitHub App installation ID is required");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    throw new HttpError(400, "A valid GitHub App installation ID is required");
  return parsed;
}

export async function createGithubAppClient(): Promise<Octokit> {
  const { appId, privateKey } = githubAppConfiguration();
  const auth = createAppAuth({ appId, privateKey });
  const authentication = await auth({ type: "app" });
  return new Octokit({ auth: authentication.token });
}

export async function createGithubInstallationClient(
  installationId: string,
): Promise<Octokit> {
  const { appId, privateKey } = githubAppConfiguration();
  const auth = createAppAuth({
    appId,
    privateKey,
    installationId: parseGithubInstallationId(installationId),
  });
  const authentication = await auth({ type: "installation" });
  return new Octokit({ auth: authentication.token });
}

export async function verifyGithubInstallation(
  installationId: string,
  clients: GithubAppClients = {},
): Promise<VerifiedGithubInstallation> {
  const numericId = parseGithubInstallationId(installationId);
  const appClient = clients.app ?? (await createGithubAppClient());
  const installationResponse = await appClient.rest.apps.getInstallation({
    installation_id: numericId,
  });
  const installation = installationResponse.data;
  if (installation.suspended_at)
    throw new HttpError(409, "The GitHub App installation is suspended");

  const permissions: Record<string, string> = {};
  for (const [name, access] of Object.entries(installation.permissions ?? {})) {
    if (typeof access === "string") permissions[name] = access;
  }
  if (permissions.contents !== "write" || permissions.pull_requests !== "write")
    throw new HttpError(
      409,
      "The GitHub App installation must grant Contents and Pull requests read/write access",
    );

  const account = installation.account;
  const accountLogin = account && "login" in account ? account.login : null;
  const accountId = account && "id" in account ? account.id : null;
  if (!accountLogin || typeof accountId !== "number")
    throw new HttpError(409, "GitHub did not return an installation account");

  const installationClient =
    clients.installation ?? (await createGithubInstallationClient(installationId));
  const repositories = await installationClient.paginate(
    installationClient.rest.apps.listReposAccessibleToInstallation,
    { per_page: 100 },
  );
  const normalizedRepositories = repositories
    .filter(
      (repository) =>
        typeof repository.full_name === "string" &&
        typeof repository.default_branch === "string",
    )
    .map((repository) => ({
      repository: repository.full_name,
      defaultBranch: repository.default_branch,
      private: repository.private,
    }))
    .sort((left, right) => left.repository.localeCompare(right.repository));
  if (normalizedRepositories.length === 0)
    throw new HttpError(409, "Select at least one repository for CloseSpan");

  return {
    installationId,
    accountId: String(accountId),
    accountLogin,
    accountType: installation.target_type,
    repositorySelection: installation.repository_selection,
    settingsUrl: installation.html_url,
    permissions,
    repositories: normalizedRepositories,
  };
}
