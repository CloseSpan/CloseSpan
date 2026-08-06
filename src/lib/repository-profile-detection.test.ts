import { describe, expect, it, vi } from "vitest";
import { TENKI_BROWSER_PREFLIGHT_COMMAND } from "./execution-profile";

const profileRepository = vi.hoisted(() => ({ save: vi.fn() }));

vi.mock("./execution-profile-repository", () => ({
  saveDetectedExecutionProfileSuggestion: profileRepository.save,
}));

import {
  detectAndPersistGithubRepositoryProfiles,
  detectAndSaveGithubRepositoryProfiles,
  detectGithubRepositoryProfiles,
  type RepositoryMetadataGithubClient,
} from "./repository-profile-detection";

const COMMIT_SHA = "a".repeat(40);
const ROOT_TREE_SHA = "b".repeat(40);

function encoded(content: string) {
  return { content: Buffer.from(content, "utf8").toString("base64"), encoding: "base64", size: Buffer.byteLength(content) };
}

function githubFixture() {
  const blobs = new Map([
    ["pkg", encoded(JSON.stringify({
      packageManager: "npm@11.0.0",
      engines: { node: ">=22" },
      scripts: { build: "next build", start: "next start", test: "vitest", typecheck: "tsc --noEmit" },
      dependencies: { next: "16.0.0" },
      devDependencies: { typescript: "6.0.0" },
    }))],
    ["lock", encoded("lockfileVersion: 3")],
    ["web-pkg", encoded(JSON.stringify({
      scripts: { build: "vite build", dev: "vite --host 0.0.0.0 --port 4173", test: "vitest" },
      dependencies: { react: "19.0.0" },
      devDependencies: { typescript: "6.0.0", vite: "7.0.0", "@playwright/test": "1.55.0" },
    }))],
    ["pnpm", encoded("lockfileVersion: '9.0'")],
    ["python", encoded('[project]\nrequires-python = ">=3.12"\ndependencies = ["fastapi", "pytest", "mypy"]')],
    ["uv", encoded("version = 1")],
  ]);
  const trees = new Map<string, Array<Record<string, unknown>>>([
    [ROOT_TREE_SHA, [
      { path: "README.md", type: "blob", sha: "readme", size: 10_000 },
      { path: "package.json", type: "blob", sha: "pkg", size: blobs.get("pkg")?.size },
      { path: "package-lock.json", type: "blob", sha: "lock", size: blobs.get("lock")?.size },
      { path: "apps", type: "tree", sha: "apps-tree" },
      { path: "node_modules", type: "tree", sha: "ignored-tree" },
    ]],
    ["apps-tree", [
      { path: "web", type: "tree", sha: "web-tree" },
      { path: "service", type: "tree", sha: "service-tree" },
    ]],
    ["web-tree", [
      { path: "package.json", type: "blob", sha: "web-pkg", size: blobs.get("web-pkg")?.size },
      { path: "pnpm-lock.yaml", type: "blob", sha: "pnpm", size: blobs.get("pnpm")?.size },
      { path: "src", type: "tree", sha: "source-tree" },
    ]],
    ["service-tree", [
      { path: "pyproject.toml", type: "blob", sha: "python", size: blobs.get("python")?.size },
      { path: "uv.lock", type: "blob", sha: "uv", size: blobs.get("uv")?.size },
    ]],
    ["source-tree", [{ path: "index.ts", type: "blob", sha: "source", size: 100 }]],
  ]);
  const github = {
    rest: {
      git: {
        getRef: vi.fn().mockResolvedValue({ data: { object: { sha: COMMIT_SHA } } }),
        getCommit: vi.fn().mockResolvedValue({ data: { tree: { sha: ROOT_TREE_SHA } } }),
        getTree: vi.fn(async ({ tree_sha }: { tree_sha: string }) => ({
          data: { tree: trees.get(tree_sha) ?? [], truncated: false },
        })),
        getBlob: vi.fn(async ({ file_sha }: { file_sha: string }) => ({
          data: blobs.get(file_sha) ?? encoded(""),
        })),
      },
    },
  } as unknown as RepositoryMetadataGithubClient;
  return { github, methods: github.rest.git };
}

describe("repository execution-profile detection", () => {
  it("detects monorepo roots from bounded manifest metadata at the exact branch SHA", async () => {
    const { github, methods } = githubFixture();
    const result = await detectGithubRepositoryProfiles({
      installationId: "150109806",
      repository: "acme/platform",
      defaultBranch: "main",
    }, { github });

    expect(methods.getRef).toHaveBeenCalledWith({ owner: "acme", repo: "platform", ref: "heads/main" });
    expect(methods.getCommit).toHaveBeenCalledWith({ owner: "acme", repo: "platform", commit_sha: COMMIT_SHA });
    expect(result.sourceSha).toBe(COMMIT_SHA);
    expect(result.profiles.map((profile) => profile.root)).toEqual([".", "apps/service", "apps/web"]);
    expect(result.profiles[0]).toMatchObject({
      language: "typescript",
      framework: "Next.js",
      packageManager: "npm",
      runtime: "node >=22",
      commands: {
        install: "npm ci --ignore-scripts",
        build: "npm run build",
        test: "npm test",
        typecheck: "npm run typecheck",
      },
      application: {
        startCommand: "npm run start",
        port: 3000,
        healthPath: "/",
      },
      reviewState: "Pending review",
      active: false,
      detectorVersion: 3,
      environment: { image: "sandbox", snapshotId: null, runtimeFamily: "node" },
    });
    expect(result.profiles.find((profile) => profile.root === "apps/web")).toMatchObject({
      framework: "Vite",
      packageManager: "pnpm",
      commands: { install: "pnpm install --frozen-lockfile --ignore-scripts" },
      application: {
        startCommand: "pnpm run dev",
        port: 4173,
        healthPath: "/",
        browserDependencyDetected: true,
      },
    });
    expect(result.profiles.find((profile) => profile.root === "apps/service")).toMatchObject({
      language: "python",
      framework: "FastAPI",
      packageManager: "uv",
      runtime: "python >=3.12",
      commands: { test: "python -m pytest", typecheck: "python -m mypy ." },
    });
    expect(result.profiles.every((profile) => /^[a-f0-9]{64}$/.test(profile.detectionHash))).toBe(true);
    expect(methods.getBlob).not.toHaveBeenCalledWith(expect.objectContaining({ file_sha: "readme" }));
    expect(methods.getTree).not.toHaveBeenCalledWith(expect.objectContaining({ tree_sha: "ignored-tree" }));
  });

  it("persists reviewable suggestions without activating them", async () => {
    const { github } = githubFixture();
    const store = { saveDetectedSuggestion: vi.fn().mockResolvedValue({ id: "suggestion" }) };
    const result = await detectAndPersistGithubRepositoryProfiles({
      orgId: "org-1",
      installationId: "150109806",
      repository: "acme/platform",
      defaultBranch: "main",
    }, store, { github });

    expect(store.saveDetectedSuggestion).toHaveBeenCalledTimes(result.profiles.length);
    expect(store.saveDetectedSuggestion).toHaveBeenNthCalledWith(1, expect.objectContaining({
      orgId: "org-1",
      suggestion: expect.objectContaining({ reviewState: "Pending review", active: false }),
      evidence: result.evidence,
    }));
  });

  it("maps detected metadata into fail-closed persisted profile suggestions", async () => {
    profileRepository.save.mockReset().mockResolvedValue({ id: "profile-1" });
    const { github } = githubFixture();
    await detectAndSaveGithubRepositoryProfiles({
      orgId: "org-1",
      installationId: "150109806",
      repository: "acme/platform",
      defaultBranch: "main",
      actor: { actorId: "admin-1", actorName: "Admin" },
    }, { github });

    expect(profileRepository.save).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1",
      repository: "acme/platform",
      workspaceRoot: ".",
      config: expect.objectContaining({
        schemaVersion: 2,
        workingDirectory: ".",
        installCommands: ["npm ci --ignore-scripts"],
        buildCommands: ["npm run build"],
        testCommands: ["npm test"],
        typecheckCommands: ["npm run typecheck"],
        automaticInstall: true,
        automaticBuild: true,
        startCommand: "npm run start",
        applicationPort: 3000,
        healthCheckPath: "/",
        runtimeTools: { http: true, browser: false, logs: true },
        permittedPaths: ["**/*"],
        tenkiImage: null,
        tenkiSnapshotId: null,
        allowInbound: false,
        allowOutbound: false,
      }),
      detectionEvidence: expect.objectContaining({
        sourceSha: COMMIT_SHA,
        confidence: 0.96,
        detectionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      actor: { actorId: "admin-1", actorName: "Admin" },
    }));

    const browserProfileCall = profileRepository.save.mock.calls
      .map(([input]) => input)
      .find((input) => input.workspaceRoot === "apps/web");
    expect(browserProfileCall).toEqual(expect.objectContaining({
      repository: "acme/platform",
      workspaceRoot: "apps/web",
      config: expect.objectContaining({
        installCommands: [
          "pnpm install --frozen-lockfile --ignore-scripts",
          "pnpm exec playwright install chromium",
          TENKI_BROWSER_PREFLIGHT_COMMAND,
        ],
        automaticInstall: true,
        runtimeTools: { http: true, browser: true, logs: true },
        allowOutbound: true,
        secretBindings: [],
        permittedPaths: ["apps/web/**"],
      }),
    }));
  });

  it("stops traversal at configured metadata limits", async () => {
    const { github, methods } = githubFixture();
    const result = await detectGithubRepositoryProfiles({
      installationId: "150109806",
      repository: "acme/platform",
      defaultBranch: "main",
    }, {
      github,
      limits: { maxTreeEntries: 2, maxTreeRequests: 2 },
    });
    expect(result.evidence.limitsReached).toBe(true);
    expect(result.evidence.treeEntriesInspected).toBe(2);
    expect(methods.getTree).toHaveBeenCalledTimes(1);
  });
});
