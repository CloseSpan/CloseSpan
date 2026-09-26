import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  pool: { query: vi.fn() },
  client: { query: vi.fn() },
  transaction: vi.fn(),
}));
const github = vi.hoisted(() => ({ verify: vi.fn(), sync: vi.fn() }));

vi.mock("./db", () => ({ databasePool: () => database.pool, transaction: database.transaction }));
vi.mock("./workspace-persistence", () => ({
  requirePostgresWorkspace: vi.fn(), workspacePersistenceMode: () => "postgres",
}));
vi.mock("./github-app-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./github-app-auth")>();
  return { ...actual, verifyGithubInstallation: github.verify };
});
vi.mock("./github-installation-repository", () => ({ syncGithubInstallationRecords: github.sync }));

import { linkReusableGithubInstallation, listReusableGithubInstallations } from "./github-reusable-installations";

const context = {
  orgId: "target-org", actorId: "target-admin", actorName: "Admin",
  actorEmail: "admin@example.com", role: "Admin", traceId: "trace-1",
};
const eligible = {
  source_org_id: "source-org", installation_id: "150109806", account_id: "42",
  account_login: "acme", account_type: "Organization",
};
const installation = {
  installationId: "150109806", accountId: "42", accountLogin: "acme", accountType: "Organization",
  repositorySelection: "selected", settingsUrl: "https://github.com/settings/installations/150109806",
  permissions: { contents: "write", pull_requests: "write" },
  repositories: [{ repository: "acme/web", defaultBranch: "main", private: true }],
};

function defaultQuery(query: string) {
  if (query.includes("SELECT email FROM workspace_members")) {
    return { rows: [{ email: context.actorEmail }], rowCount: 1 };
  }
  if (query.includes("SELECT installation.org_id AS source_org_id")) {
    return { rows: [eligible], rowCount: 1 };
  }
  if (query.includes("SELECT DISTINCT ON (repository.repository)")) {
    return { rows: [{ repository: "acme/web", default_branch: "main" }], rowCount: 1 };
  }
  if (query.includes("INSERT INTO audit_events")) return { rows: [], rowCount: 1 };
  throw new Error(`Unexpected query: ${query}`);
}

describe("reusable GitHub installations", () => {
  beforeEach(() => {
    database.pool.query.mockReset().mockImplementation(defaultQuery);
    database.client.query.mockReset().mockImplementation(defaultQuery);
    database.transaction.mockReset().mockImplementation(
      async (work: (client: typeof database.client) => Promise<unknown>) => work(database.client),
    );
    github.verify.mockReset().mockResolvedValue(installation);
    github.sync.mockReset().mockResolvedValue([]);
  });

  it("discovers cached repositories only through matching source and target Admin memberships", async () => {
    await expect(listReusableGithubInstallations(context)).resolves.toEqual([{
      installationId: "150109806", accountLogin: "acme", accountType: "Organization",
      repositories: [{ repository: "acme/web", defaultBranch: "main" }],
    }]);
    const [targetQuery, targetParameters] = database.pool.query.mock.calls[0];
    expect(targetQuery).toContain("org_id=$1 AND id=$2 AND role='Admin'");
    expect(targetParameters).toEqual(["target-org", "target-admin"]);
    const [sourceQuery, sourceParameters] = database.pool.query.mock.calls[1];
    expect(sourceQuery).toContain("installation.org_id<>$1");
    expect(sourceQuery).toContain("installation.active=true AND installation.workspace_connected=true");
    expect(sourceQuery).toContain("member.role='Admin'");
    expect(sourceQuery).toContain("NOT EXISTS");
    expect(sourceQuery).toContain("current_installation.org_id=$1");
    expect(sourceParameters).toEqual(["target-org", "admin@example.com"]);
    const [repositoriesQuery] = database.pool.query.mock.calls[2];
    expect(repositoriesQuery).toContain("repository.active=true");
    expect(repositoriesQuery).toContain("member.role='Admin'");
    expect(repositoriesQuery).not.toContain("workspace_selected=true");
    expect(github.verify).not.toHaveBeenCalled();
    expect(github.sync).not.toHaveBeenCalled();
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it("deduplicates an installation connected to more than one eligible workspace", async () => {
    database.pool.query.mockImplementation((query: string) => query.includes("AS source_org_id")
      ? { rows: [eligible, { ...eligible, source_org_id: "another-org" }], rowCount: 2 }
      : defaultQuery(query));
    expect(await listReusableGithubInstallations(context)).toHaveLength(1);
    expect(database.pool.query.mock.calls.filter(([query]) => query.includes("SELECT DISTINCT"))).toHaveLength(1);
  });

  it("normalizes trusted email aliases consistently with workspace membership", async () => {
    database.pool.query.mockImplementation((query: string) => query.includes("SELECT email")
      ? { rows: [{ email: "Ad.Min+workspace@googlemail.com" }], rowCount: 1 }
      : defaultQuery(query));
    await listReusableGithubInstallations({ ...context, actorEmail: "admin@gmail.com" });
    expect(database.pool.query.mock.calls[1][1]).toEqual(["target-org", "admin@gmail.com"]);
  });

  it("rejects a non-Admin before accessing discovery data", async () => {
    await expect(listReusableGithubInstallations({ ...context, role: "Contributor" })).rejects.toMatchObject({ status: 403 });
    expect(database.pool.query).not.toHaveBeenCalled();
  });

  it("rejects a missing or revoked target Admin", async () => {
    database.pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(listReusableGithubInstallations(context)).rejects.toMatchObject({ status: 403 });
    expect(database.pool.query).toHaveBeenCalledTimes(1);
  });

  it("rejects an actor ID that belongs to a different authenticated email", async () => {
    database.pool.query.mockResolvedValue({ rows: [{ email: "other@example.com" }], rowCount: 1 });
    await expect(listReusableGithubInstallations(context)).rejects.toMatchObject({ status: 403 });
    expect(database.pool.query).toHaveBeenCalledTimes(1);
  });

  it("returns no installations when the actor has no eligible source Admin binding", async () => {
    database.pool.query.mockImplementation((query: string) => query.includes("AS source_org_id")
      ? { rows: [], rowCount: 0 } : defaultQuery(query));
    await expect(listReusableGithubInstallations(context)).resolves.toEqual([]);
    expect(database.pool.query).toHaveBeenCalledTimes(2);
  });

  it("freshly verifies and explicitly links without copying source repository selections", async () => {
    await expect(linkReusableGithubInstallation(context, "150109806")).resolves.toEqual({ linked: true });
    expect(github.verify).toHaveBeenCalledWith("150109806");
    expect(github.sync).toHaveBeenCalledWith(database.client, "target-org", installation, {
      preserveWorkspaceRepositoryBindings: true,
    });
    expect(database.client.query.mock.calls[0][0]).toContain("FOR SHARE");
    expect(database.client.query.mock.calls[1][0]).toContain("FOR SHARE OF installation, member");
    expect(database.client.query.mock.calls[1][1]).toEqual(["target-org", "admin@example.com", "150109806"]);
    expect(database.client.query.mock.calls[2][0]).toContain("INSERT INTO audit_events");
    expect(database.client.query.mock.calls[2][1]?.slice(1, 4)).toEqual(["target-org", "target-admin", "Admin"]);
  });

  it("rejects arbitrary installation IDs before contacting GitHub", async () => {
    database.pool.query.mockImplementation((query: string) => query.includes("AS source_org_id")
      ? { rows: [], rowCount: 0 } : defaultQuery(query));
    await expect(linkReusableGithubInstallation(context, "99999999")).rejects.toMatchObject({ status: 404 });
    expect(github.verify).not.toHaveBeenCalled();
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it("rejects malformed installation IDs before database access", async () => {
    await expect(linkReusableGithubInstallation(context, "../admin")).rejects.toMatchObject({ status: 400 });
    expect(database.pool.query).not.toHaveBeenCalled();
    expect(github.verify).not.toHaveBeenCalled();
  });

  it("does not link an installation suspended or revoked at GitHub", async () => {
    github.verify.mockRejectedValue(new Error("The GitHub App installation is suspended"));
    await expect(linkReusableGithubInstallation(context, "150109806")).rejects.toThrow("suspended");
    expect(database.transaction).not.toHaveBeenCalled();
    expect(github.sync).not.toHaveBeenCalled();
  });

  it("rejects mismatched fresh installation identity", async () => {
    github.verify.mockResolvedValue({ ...installation, accountId: "999" });
    await expect(linkReusableGithubInstallation(context, "150109806")).rejects.toMatchObject({ status: 409 });
    expect(github.sync).not.toHaveBeenCalled();
  });

  it("rejects source membership or binding revoked during GitHub verification", async () => {
    database.client.query.mockImplementation((query: string) => query.includes("AS source_org_id")
      ? { rows: [], rowCount: 0 } : defaultQuery(query));
    await expect(linkReusableGithubInstallation(context, "150109806")).rejects.toMatchObject({ status: 404 });
    expect(github.sync).not.toHaveBeenCalled();
  });

  it("rejects target Admin access revoked during GitHub verification", async () => {
    database.client.query.mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(linkReusableGithubInstallation(context, "150109806")).rejects.toMatchObject({ status: 403 });
    expect(github.sync).not.toHaveBeenCalled();
  });
});
