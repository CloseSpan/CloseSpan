import { createHash } from "node:crypto";
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

function mobileGithubFixture(platform: "ios" | "android") {
  const workflow = "name: CloseSpan runner\non: workflow_dispatch\n";
  const blobs = new Map<string, ReturnType<typeof encoded>>([
    ["workflow", encoded(workflow)],
    ...(platform === "ios" ? [
      ["package", encoded(JSON.stringify({ scripts: { test: "vitest" }, devDependencies: { vite: "7.0.0" } }))],
      ["project", encoded("LastUpgradeCheck = 2610; IPHONEOS_DEPLOYMENT_TARGET = 18.0; SDKROOT = iphoneos; /* SwiftUI */")],
      ["scheme", encoded("<Scheme version=\"1.7\"></Scheme>")],
      ["internal-workspace", encoded("<Workspace version=\"1.0\"></Workspace>")],
    ] : [
      ["gradle", encoded([
        "plugins { id(\"com.android.application\") version \"8.8.0\"; id(\"org.jetbrains.kotlin.android\") version \"2.1.0\" }",
        "android { compileSdk = 34 }",
        "kotlin { jvmToolchain(17) }",
      ].join("\n"))],
      ["wrapper", encoded("distributionUrl=https\\://services.gradle.org/distributions/gradle-8.9-bin.zip")],
    ]),
  ] as Array<[string, ReturnType<typeof encoded>]>);
  const trees = new Map<string, Array<Record<string, unknown>>>([
    [ROOT_TREE_SHA, platform === "ios" ? [
      { path: "package.json", type: "blob", sha: "package", size: blobs.get("package")?.size },
      { path: "Zup.xcodeproj", type: "tree", sha: "project-tree" },
      { path: ".github", type: "tree", sha: "github-tree" },
    ] : [
      { path: "build.gradle.kts", type: "blob", sha: "gradle", size: blobs.get("gradle")?.size },
      { path: "gradle", type: "tree", sha: "gradle-tree" },
      { path: ".github", type: "tree", sha: "github-tree" },
    ]],
    ["gradle-tree", [{ path: "wrapper", type: "tree", sha: "wrapper-tree" }]],
    ["wrapper-tree", [{
      path: "gradle-wrapper.properties",
      type: "blob",
      sha: "wrapper",
      size: blobs.get("wrapper")?.size,
    }]],
    ["project-tree", [
      { path: "project.pbxproj", type: "blob", sha: "project", size: blobs.get("project")?.size },
      ...(platform === "ios" ? [{ path: "project.xcworkspace", type: "tree", sha: "internal-workspace-tree" }] : []),
      { path: "xcshareddata", type: "tree", sha: "shared-tree" },
    ]],
    ["internal-workspace-tree", [{
      path: "contents.xcworkspacedata",
      type: "blob",
      sha: "internal-workspace",
      size: blobs.get("internal-workspace")?.size,
    }]],
    ["shared-tree", [{ path: "xcschemes", type: "tree", sha: "schemes-tree" }]],
    ["schemes-tree", [{ path: "Zup.xcscheme", type: "blob", sha: "scheme", size: blobs.get("scheme")?.size }]],
    ["github-tree", [{ path: "workflows", type: "tree", sha: "workflows-tree" }]],
    ["workflows-tree", [{
      path: "closespan-agent-runner.yml", type: "blob", sha: "workflow", size: blobs.get("workflow")?.size,
    }]],
  ]);
  return {
    workflow,
    github: {
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
    } as unknown as RepositoryMetadataGithubClient,
  };
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
      detectorVersion: 9,
      environment: { image: "sandbox", snapshotId: null, runtimeFamily: "node" },
      compatibilityRequirements: {
        schemaVersion: 1,
        sourceSha: COMMIT_SHA,
        ecosystem: "node",
        runtimeFamily: "node",
        runtimeConstraint: ">=22",
        packageManager: "npm",
        toolchains: [{ name: "npm", constraint: "11.0.0" }],
        capabilities: [],
        validationKind: "managed_environment",
      },
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
      compatibilityRequirements: {
        ecosystem: "python",
        runtimeFamily: "python",
        runtimeConstraint: ">=3.12",
        packageManager: "uv",
        validationKind: "managed_environment",
      },
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

  it("does not treat LastUpgradeCheck as a minimum Xcode runtime requirement", async () => {
    profileRepository.save.mockReset().mockResolvedValue({ id: "profile-ios" });
    const { github, workflow } = mobileGithubFixture("ios");
    const detected = await detectAndSaveGithubRepositoryProfiles({
      orgId: "org-1",
      installationId: "150109806",
      repository: "samshanmukh/zup",
      defaultBranch: "main",
    }, { github });

    expect(detected.profiles).toHaveLength(1);
    expect(detected.profiles[0]).toMatchObject({
      root: ".",
      platform: "ios",
      language: "swift",
      xcode: { version: "16", containerKind: "project", containerPath: "Zup.xcodeproj", scheme: "Zup" },
      commands: {
        test: "swiftc -parse-as-library tests/CloseSpanPDDTests.swift -o /tmp/closespan-pdd-tests && /tmp/closespan-pdd-tests",
      },
      runnerWorkflowSha256: createHash("sha256").update(workflow).digest("hex"),
    });
    expect(profileRepository.save).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        schemaVersion: 3,
        language: "swift",
        tenkiImage: null,
        executor: expect.objectContaining({
          kind: "tenki_github_actions",
          platform: "macos",
          architecture: "arm64",
          workflowPath: ".github/workflows/closespan-agent-runner.yml",
          workflowSha256: createHash("sha256").update(workflow).digest("hex"),
          xcode: expect.objectContaining({ version: "16", scheme: "Zup", signingPolicy: "simulator_only" }),
        }),
      }),
      detectionEvidence: expect.objectContaining({
        platform: "ios",
        compatibilityRequirements: expect.objectContaining({
          ecosystem: "ios",
          validationKind: "runner_probe",
          capabilities: ["ios-simulator"],
          toolchains: expect.arrayContaining([
            { name: "Xcode", constraint: "16" },
          ]),
        }),
      }),
    }));
  });

  it("rebases a nested Xcode project to its execution-profile working directory", async () => {
    profileRepository.save.mockReset().mockResolvedValue({ id: "profile-ios-nested" });
    const { github, workflow } = mobileGithubFixture("ios");
    const getTree = vi.mocked(github.rest.git.getTree);
    const originalImplementation = getTree.getMockImplementation();
    if (!originalImplementation) throw new Error("Expected the mobile GitHub fixture tree implementation");
    getTree.mockImplementation(async (input) => {
      const { tree_sha } = input;
      if (tree_sha === ROOT_TREE_SHA) {
        return { data: { tree: [
          { path: "ZupNative", type: "tree", sha: "nested-project-root" },
          { path: ".github", type: "tree", sha: "github-tree" },
        ], truncated: false } };
      }
      if (tree_sha === "nested-project-root") {
        return { data: { tree: [
          { path: "Zup.xcodeproj", type: "tree", sha: "project-tree" },
        ], truncated: false } };
      }
      return originalImplementation(input);
    });

    const detected = await detectAndSaveGithubRepositoryProfiles({
      orgId: "org-1",
      installationId: "150109806",
      repository: "samshanmukh/zup",
      defaultBranch: "main",
    }, { github });

    expect(detected.profiles[0]).toMatchObject({
      root: "ZupNative",
      xcode: { containerKind: "project", containerPath: "Zup.xcodeproj", scheme: "Zup" },
      commands: {
        test: "swiftc -parse-as-library tests/CloseSpanPDDTests.swift -o /tmp/closespan-pdd-tests && /tmp/closespan-pdd-tests",
      },
      runnerWorkflowSha256: createHash("sha256").update(workflow).digest("hex"),
    });
  });

  it("routes Android instrumentation to a Tenki Linux x64 runner with nested-KVM metadata", async () => {
    profileRepository.save.mockReset().mockResolvedValue({ id: "profile-android" });
    const { github } = mobileGithubFixture("android");
    await detectAndSaveGithubRepositoryProfiles({
      orgId: "org-1",
      installationId: "150109806",
      repository: "acme/android",
      defaultBranch: "main",
    }, { github });

    expect(profileRepository.save).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        schemaVersion: 3,
        framework: "Android",
        executor: expect.objectContaining({
          kind: "tenki_github_actions",
          platform: "linux",
          architecture: "x64",
          runnerLabel: "tenki-standard-large-8c-16g",
          androidEmulator: expect.objectContaining({
            apiLevel: 34,
            architecture: "x86_64",
            gradleTask: ":app:connectedDebugAndroidTest",
          }),
        }),
      }),
      detectionEvidence: expect.objectContaining({
        platform: "android",
        compatibilityRequirements: expect.objectContaining({
          ecosystem: "android",
          validationKind: "runner_probe",
          capabilities: ["android-emulator", "nested-kvm"],
          toolchains: expect.arrayContaining([
            { name: "Android SDK API", constraint: "34" },
            { name: "Android emulator ABI", constraint: "x86_64" },
            { name: "Gradle", constraint: "8.9" },
            { name: "JDK", constraint: "17" },
            { name: "Kotlin", constraint: "2.1.0" },
          ]),
        }),
      }),
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
        // A generic toolchain image still needs temporary outbound access for
        // its reviewed dependency install. Repository-private environments
        // switch this back off because dependencies are sealed in the image.
        allowOutbound: true,
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
