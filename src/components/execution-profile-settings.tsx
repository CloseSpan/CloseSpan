"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Github } from "lucide-react";
import { CustomSelect } from "@/components/custom-select";
import type {
  ExecutionProfileAssignmentView,
  ExecutionProfileSettingsView,
} from "@/lib/execution-profile-repository";
import {
  TENKI_BROWSER_PREFLIGHT_COMMAND,
  executionProfileExecutor,
  executionProfileBrowserReadiness,
  isPlaywrightChromiumInstallCommand,
  playwrightChromiumInstallCommand,
  upgradeExecutionProfileConfigV2,
  type ExecutionProfileConfig,
  type ExecutionProfileConfigV2,
  type ExecutionProfileConfigV3,
  type ExecutionProfileVersion,
} from "@/lib/execution-profile";
import type {
  ExecutionProfilePublicEnvironmentVariable,
  ExecutionProfileSecretBinding,
} from "@/lib/execution-profile";
import type { GithubRepositoryAuthorization } from "@/lib/github-repository-allowlist";
import {
  runtimeFamilyForExecutionProfile,
  type ManagedTenkiEnvironmentArtifact,
} from "@/lib/tenki-environment-catalog";
import type { PendingTenkiRunnerWorkflowSetup } from "@/lib/tenki-runner-workflow-setup-repository";
import type { ExecutionCompatibilityReadiness } from "@/lib/execution-compatibility";
import {
  tenkiRunnerSize,
  tenkiRunnerSizesForPlatform,
} from "@/lib/tenki-runner-sizing";
import {
  githubActionsRunnerLabel,
  runnerProviderForLabel,
} from "@/lib/github-actions-runner-label";

interface ExecutionProfileApiView extends ExecutionProfileSettingsView {
  available: boolean;
  repositories: GithubRepositoryAuthorization[];
  managedEnvironments: ManagedTenkiEnvironmentArtifact[];
  runnerWorkflowSetups: PendingTenkiRunnerWorkflowSetup[];
  compatibilityByProfileId: Record<string, ExecutionCompatibilityReadiness>;
}

interface ApiResult {
  error?: string;
  settings?: ExecutionProfileSettingsView;
}

interface RunnerWorkflowInstallationResult {
  error?: string;
  status?: "installed" | "pull_request";
  pullRequestNumber?: number | null;
  pullRequestUrl?: string | null;
}

interface RunnerWorkflowPullRequest {
  number: number;
  url: string;
}

interface RunnerWorkflowMergeResult {
  error?: string;
  status?: "merged" | "installed";
  pullRequestUrl?: string | null;
  mergedSha?: string;
  githubActionsChecksPassed?: number;
}

interface RuntimeSecretVersionMetadata {
  version: number;
  active: boolean;
  createdAt: string;
  revokedAt: string | null;
}

interface RuntimeSecretMetadata {
  id: string;
  environmentName: string;
  label: string;
  scopeType: "workspace" | "repository";
  repository: string;
  workspaceRoot: string;
  createdAt: string;
  versions: RuntimeSecretVersionMetadata[];
}

interface RuntimeSecretApiResult {
  error?: string;
  secret?: RuntimeSecretMetadata;
  secrets?: RuntimeSecretMetadata[];
}

export interface RuntimeSecretBindingOption {
  token: string;
  secretId: string;
  secretVersion: number;
  environmentName: string;
  label: string;
  scopeType: "workspace" | "repository";
}

export function runtimeSecretBindingOptions(
  secrets: RuntimeSecretMetadata[],
  repository: string,
  workspaceRoot: string,
): RuntimeSecretBindingOption[] {
  return secrets
    .filter((secret) => secret.scopeType === "workspace"
      || (secret.repository === repository && secret.workspaceRoot === workspaceRoot))
    .flatMap((secret) => secret.versions
      .filter((version) => version.active)
      .map((version) => ({
        token: `${secret.id}:${version.version}`,
        secretId: secret.id,
        secretVersion: version.version,
        environmentName: secret.environmentName,
        label: secret.label,
        scopeType: secret.scopeType,
      })))
    .sort((left, right) => left.environmentName.localeCompare(right.environmentName)
      || right.secretVersion - left.secretVersion);
}

function requestHeaders(orgId: string, mutation = false): HeadersInit {
  return {
    "x-org-id": orgId,
    "x-request-id": crypto.randomUUID(),
    ...(mutation
      ? {
          "content-type": "application/json",
          "idempotency-key": `profile_${crypto.randomUUID().replaceAll("-", "")}`,
        }
      : {}),
  };
}

async function loadRuntimeSecretMetadata(
  orgId: string,
  signal?: AbortSignal,
): Promise<RuntimeSecretMetadata[]> {
  const response = await fetch("/api/settings/runtime-secrets", {
    headers: requestHeaders(orgId),
    cache: "no-store",
    signal,
  });
  const payload = await response.json() as RuntimeSecretApiResult;
  if (!response.ok || !payload.secrets) {
    throw new Error(payload.error ?? "Runtime secret metadata could not be loaded.");
  }
  return payload.secrets;
}

function commandText(commands: string[]): string {
  return commands.join("\n");
}

function commandList(value: string): string[] {
  return value
    .split("\n")
    .map((command) => command.trim())
    .filter(Boolean);
}

export function configureBrowserInteraction<
  Config extends ExecutionProfileConfigV2 | ExecutionProfileConfigV3,
>(
  config: Config,
  enabled: boolean,
): { config: Config; error?: string } {
  const retainedInstallCommands = config.installCommands.filter(
    (command) => command !== TENKI_BROWSER_PREFLIGHT_COMMAND
      && !isPlaywrightChromiumInstallCommand(command),
  );
  if (!enabled) {
    return {
      config: {
        ...config,
        installCommands: retainedInstallCommands,
        automaticInstall: retainedInstallCommands.length > 0
          ? config.automaticInstall
          : false,
        runtimeTools: { ...config.runtimeTools, browser: false },
      },
    };
  }

  const imageProvisioned = Boolean(config.tenkiImage || config.tenkiSnapshotId);
  const installCommand = playwrightChromiumInstallCommand(config.packageManager);
  if (!imageProvisioned && !installCommand) {
    return {
      config,
      error: "Choose npm, pnpm, yarn, or bun, or select a browser-ready Tenki image or snapshot first.",
    };
  }
  if (
    (config.allowOutbound || !imageProvisioned)
    && config.secretBindings.some((binding) => binding.exposure === "runtime" || binding.exposure === "test")
  ) {
    return {
      config,
      error: "Outbound browser profiles cannot share runtime or test secrets until scoped egress policies are available. Disable outbound access or remove those bindings.",
    };
  }

  const browserCommands = imageProvisioned
    ? [TENKI_BROWSER_PREFLIGHT_COMMAND]
    : [installCommand!, TENKI_BROWSER_PREFLIGHT_COMMAND];
  if (retainedInstallCommands.length + browserCommands.length > 30) {
    return {
      config,
      error: "Remove an install command before enabling browser interaction. Execution profiles support at most 30 install commands.",
    };
  }
  return {
    config: {
      ...config,
      installCommands: [...retainedInstallCommands, ...browserCommands],
      automaticInstall: true,
      allowOutbound: imageProvisioned ? config.allowOutbound : true,
      runtimeTools: { ...config.runtimeTools, browser: true },
    },
  };
}

function compactHash(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function profileLabel(profile: ExecutionProfileVersion): string {
  if (profile.source === "safe_generic") return "Safe generic fallback";
  if (profile.source === "detected") return "Detected suggestion";
  if (profile.source === "confirmed") return "Confirmed detection";
  return "Admin override";
}

function runnerSelectionEvidence(profile: ExecutionProfileVersion): {
  provider: "tenki" | "github_hosted";
  fallbackReason: string | null;
} | null {
  const sizing = profile.detectionEvidence?.runnerSizing;
  if (!sizing || typeof sizing !== "object" || Array.isArray(sizing)) return null;
  const provider = "provider" in sizing && (sizing.provider === "tenki" || sizing.provider === "github_hosted")
    ? sizing.provider
    : null;
  if (!provider) return null;
  return {
    provider,
    fallbackReason: "fallbackReason" in sizing && typeof sizing.fallbackReason === "string"
      ? sizing.fallbackReason
      : null,
  };
}

function runtimeSecretScopeLabel(secret: RuntimeSecretMetadata): string {
  if (secret.scopeType === "workspace") return "All authorized repositories";
  return `${secret.repository} · ${secret.workspaceRoot}`;
}

function RuntimeSecretManager({
  orgId,
  secrets,
  repositories,
  loading,
  error,
  onRetry,
  onChanged,
}: {
  orgId: string;
  secrets: RuntimeSecretMetadata[];
  repositories: GithubRepositoryAuthorization[];
  loading: boolean;
  error?: string;
  onRetry: () => void;
  onChanged: (secret: RuntimeSecretMetadata) => void;
}) {
  const activeRepositories = repositories.filter((repository) => repository.active);
  const [environmentName, setEnvironmentName] = useState("");
  const [label, setLabel] = useState("");
  const [scopeType, setScopeType] = useState<"workspace" | "repository">("repository");
  const [repository, setRepository] = useState("");
  const [workspaceRoot, setWorkspaceRoot] = useState(".");
  const [secretValue, setSecretValue] = useState("");
  const [action, setAction] = useState<{ secretId: string; type: "rotate" | "revoke" }>();
  const [rotateValue, setRotateValue] = useState("");
  const [revokeReason, setRevokeReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const selectedRepository = repository || activeRepositories[0]?.repository || "";

  async function mutate(
    method: "POST" | "PUT" | "DELETE",
    body: Record<string, unknown>,
  ): Promise<RuntimeSecretMetadata> {
    const response = await fetch("/api/settings/runtime-secrets", {
      method,
      headers: requestHeaders(orgId, true),
      body: JSON.stringify(body),
    });
    const payload = await response.json() as RuntimeSecretApiResult;
    if (!response.ok || !payload.secret) {
      throw new Error(payload.error ?? "The runtime secret could not be updated.");
    }
    return payload.secret;
  }

  async function createSecret(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (scopeType === "repository" && !selectedRepository) {
      setActionError("Connect and authorize a GitHub repository before creating a repository-scoped secret.");
      return;
    }
    setBusy(true);
    setActionError(undefined);
    setNotice(undefined);
    try {
      const created = await mutate("POST", {
        environmentName,
        label: label || undefined,
        scopeType,
        repository: scopeType === "repository" ? selectedRepository : undefined,
        workspaceRoot: scopeType === "repository" ? workspaceRoot : undefined,
        value: secretValue,
      });
      onChanged(created);
      setEnvironmentName("");
      setLabel("");
      setSecretValue("");
      setNotice(`${created.environmentName} was encrypted and stored. Its value will not be shown again.`);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "The runtime secret could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function rotateSecret(secret: RuntimeSecretMetadata): Promise<void> {
    setBusy(true);
    setActionError(undefined);
    setNotice(undefined);
    try {
      const rotated = await mutate("PUT", {
        secretId: secret.id,
        value: rotateValue,
        revokePrevious: true,
      });
      onChanged(rotated);
      setRotateValue("");
      setAction(undefined);
      const activeVersion = rotated.versions.find((version) => version.active);
      setNotice(`${rotated.environmentName} was rotated${activeVersion ? ` to version ${activeVersion.version}` : ""}. Existing profiles remain pinned to their recorded version.`);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "The runtime secret could not be rotated.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeSecret(secret: RuntimeSecretMetadata, version: number): Promise<void> {
    setBusy(true);
    setActionError(undefined);
    setNotice(undefined);
    try {
      const revoked = await mutate("DELETE", {
        secretId: secret.id,
        version,
        reason: revokeReason || undefined,
      });
      onChanged(revoked);
      setRevokeReason("");
      setAction(undefined);
      setNotice(`${revoked.environmentName} version ${version} was revoked. Profiles bound to it can no longer execute.`);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "The runtime secret version could not be revoked.");
    } finally {
      setBusy(false);
    }
  }

  function openAction(secretId: string, type: "rotate" | "revoke"): void {
    setAction((current) => current?.secretId === secretId && current.type === type
      ? undefined
      : { secretId, type });
    setRotateValue("");
    setRevokeReason("");
    setActionError(undefined);
    setNotice(undefined);
  }

  return (
    <details
      className="runtime-secret-manager"
      open={error ? true : undefined}
    >
      <summary className="runtime-secret-manager-summary">
        <span className="runtime-secret-manager-heading">
          <span className="runtime-secret-manager-title-line">
            <strong id="runtime-secret-manager-title">Runtime environment secrets</strong>
            <span className="badge">Advanced</span>
          </span>
          <span className="subtle">Add staging credentials only when an authorized repository must run inside Tenki.</span>
        </span>
        <span className="runtime-secret-manager-status">
          <span className="subtle">{secrets.length} {secrets.length === 1 ? "secret" : "secrets"}</span>
          <span className="badge success">Encrypted at rest</span>
        </span>
      </summary>

      <div className="runtime-secret-manager-body">
        <div className="callout warning runtime-secret-safety" role="note">
          <div className="callout-title">Use staging or test credentials only</div>
          <p className="subtle">Never add production database credentials or access to live customer data. Prefer short-lived, least-privilege values scoped to one repository and workspace root.</p>
        </div>

        <form className="runtime-secret-create" onSubmit={createSecret}>
        <div className="runtime-secret-create-head">
          <strong>Add a secret</strong>
          <span className="subtle">The value is write-only and cannot be retrieved after storage.</span>
        </div>
        <fieldset className="runtime-secret-create-grid" disabled={busy}>
          <label className="field">Environment name
            <input
              value={environmentName}
              required
              maxLength={128}
              pattern="[A-Z_][A-Z0-9_]*"
              placeholder="TEST_DATABASE_URL"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => setEnvironmentName(event.target.value.toUpperCase())}
            />
            <small>Uppercase letters, numbers, and underscores. Reserved executor names are rejected.</small>
          </label>
          <label className="field">Label
            <input value={label} maxLength={120} placeholder="Staging database" onChange={(event) => setLabel(event.target.value)} />
            <small>Human-readable context only. Never include the secret value.</small>
          </label>
          <label className="field">Scope
            <select value={scopeType} onChange={(event) => setScopeType(event.target.value as "workspace" | "repository")}>
              <option value="repository">Repository and root</option>
              <option value="workspace">Entire workspace</option>
            </select>
            <small>Repository scope is safest. Workspace scope makes the secret eligible for every authorized repository.</small>
          </label>
          {scopeType === "repository" && (
            <>
              <label className="field">Repository
                <select required value={selectedRepository} onChange={(event) => setRepository(event.target.value)}>
                  {activeRepositories.length === 0 && <option value="">No authorized repositories</option>}
                  {activeRepositories.map((item) => <option key={item.id} value={item.repository}>{item.repository}</option>)}
                </select>
              </label>
              <label className="field">Workspace root
                <input required value={workspaceRoot} maxLength={500} placeholder="." spellCheck={false} onChange={(event) => setWorkspaceRoot(event.target.value)} />
                <small>Must exactly match the repository profile root that receives this secret.</small>
              </label>
            </>
          )}
          {scopeType === "workspace" && (
            <div className="callout warning runtime-secret-workspace-warning" role="status">
              <div className="callout-title">This secret will be available workspace-wide</div>
              <p className="subtle">Every authorized repository can bind this version. Use repository scope unless the same test credential is intentionally shared.</p>
            </div>
          )}
          <label className="field runtime-secret-value-field">Secret value
            <input
              type="password"
              value={secretValue}
              required
              minLength={4}
              maxLength={16_384}
              autoComplete="new-password"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby="runtime-secret-value-hint"
              onChange={(event) => setSecretValue(event.target.value)}
            />
            <small id="runtime-secret-value-hint">Sent once through the authenticated admin API, encrypted, and cleared from this form after storage.</small>
          </label>
        </fieldset>
        <div className="runtime-secret-form-actions">
          <button type="submit" className="btn primary" disabled={busy || !environmentName || secretValue.length < 4 || (scopeType === "repository" && !selectedRepository)}>
            {busy ? "Encrypting…" : "Encrypt & store"}
          </button>
        </div>
        </form>

        <div className="runtime-secret-feedback" aria-live="polite">
        {notice && <p className="toast success" role="status">{notice}</p>}
        {(error || actionError) && (
          <div className="toast error" role="alert">
            <span>{actionError ?? error}</span>
            {error && !actionError && <button type="button" className="text-link" onClick={onRetry}>Try again</button>}
          </div>
        )}
        </div>

        <div className="runtime-secret-list" aria-busy={loading}>
          <div className="runtime-secret-list-head">
            <strong>Stored secret metadata</strong>
            <span className="subtle">{secrets.length} {secrets.length === 1 ? "secret" : "secrets"}</span>
          </div>
          {loading && <p className="chatgpt-text-loading" role="status">Loading secret metadata<span aria-hidden="true">…</span></p>}
          {!loading && !error && secrets.length === 0 && (
            <div className="runtime-secret-empty">
              <strong>No runtime secrets yet</strong>
              <p className="subtle">Add the first write-only value above, then bind its active version inside a runtime profile.</p>
            </div>
          )}
          {!loading && secrets.map((secret) => {
          const activeVersion = secret.versions.find((version) => version.active);
          const revokedCount = secret.versions.filter((version) => !version.active).length;
          const editing = action?.secretId === secret.id;
          return (
            <div className="runtime-secret-row" key={secret.id}>
              <div className="runtime-secret-row-main">
                <div className="runtime-secret-identity">
                  <strong>{secret.label}</strong>
                  <code>{secret.environmentName}</code>
                  <span className="subtle">{runtimeSecretScopeLabel(secret)}</span>
                </div>
                <div className="runtime-secret-version">
                  {activeVersion
                    ? <span className="badge success">Active · v{activeVersion.version}</span>
                    : <span className="badge high">No active version</span>}
                  {revokedCount > 0 && <span className="subtle">{revokedCount} revoked</span>}
                </div>
                <div className="runtime-secret-actions">
                  <button type="button" className="btn secondary" disabled={busy} aria-expanded={editing && action.type === "rotate"} onClick={() => openAction(secret.id, "rotate")}>Rotate</button>
                  <button type="button" className="btn danger" disabled={busy || !activeVersion} aria-expanded={editing && action.type === "revoke"} onClick={() => openAction(secret.id, "revoke")}>Revoke</button>
                </div>
              </div>
              {editing && action.type === "rotate" && (
                <form className="runtime-secret-inline-form" onSubmit={(event) => { event.preventDefault(); void rotateSecret(secret); }}>
                  <label className="field">New value for {secret.environmentName}
                    <input type="password" value={rotateValue} required minLength={4} maxLength={16_384} autoComplete="new-password" spellCheck={false} onChange={(event) => setRotateValue(event.target.value)} />
                    <small>Creates a new immutable version and revokes the current one. Existing profiles are not silently rebound.</small>
                  </label>
                  <div className="runtime-secret-inline-actions">
                    <button type="button" className="btn subtle" disabled={busy} onClick={() => setAction(undefined)}>Cancel</button>
                    <button type="submit" className="btn primary" disabled={busy || rotateValue.length < 4}>{busy ? "Rotating…" : "Rotate value"}</button>
                  </div>
                </form>
              )}
              {editing && action.type === "revoke" && activeVersion && (
                <form className="runtime-secret-inline-form runtime-secret-revoke" onSubmit={(event) => { event.preventDefault(); void revokeSecret(secret, activeVersion.version); }}>
                  <div>
                    <strong>Revoke {secret.environmentName} version {activeVersion.version}?</strong>
                    <p className="subtle">Any approved profile pinned to this version will fail closed until an admin binds another active version.</p>
                  </div>
                  <label className="field">Reason (optional)
                    <input value={revokeReason} maxLength={500} placeholder="Credential rotated at provider" onChange={(event) => setRevokeReason(event.target.value)} />
                  </label>
                  <div className="runtime-secret-inline-actions">
                    <button type="button" className="btn subtle" disabled={busy} onClick={() => setAction(undefined)}>Keep active</button>
                    <button type="submit" className="btn danger" disabled={busy}>{busy ? "Revoking…" : `Revoke v${activeVersion.version}`}</button>
                  </div>
                </form>
              )}
            </div>
          );
          })}
        </div>
      </div>
    </details>
  );
}

function ProfileSummary({ profile }: { profile: ExecutionProfileVersion }) {
  const config = profile.config;
  const executor = executionProfileExecutor(config);
  const actualRunnerLabel = executor.kind === "tenki_github_actions"
    ? githubActionsRunnerLabel(executor)
    : null;
  const runnerEvidence = runnerSelectionEvidence(profile);
  const runnerProvider = actualRunnerLabel
    ? runnerProviderForLabel(actualRunnerLabel)
    : null;
  const commands = [
    ...config.installCommands,
    ...config.buildCommands,
    ...config.testCommands,
    ...config.typecheckCommands,
  ];
  return (
    <div className="execution-profile-summary">
      <div className="execution-profile-facts">
        <span><small>Runtime</small><strong>{config.language}{config.runtimeVersion ? ` · ${config.runtimeVersion}` : ""}</strong></span>
        <span><small>Framework</small><strong>{config.framework ?? "Not detected"}</strong></span>
        <span><small>Package manager</small><strong>{config.packageManager}</strong></span>
        <span><small>Resources</small><strong>{config.cpuCores} CPU · {Math.round(config.memoryMb / 1_024)} GB</strong></span>
        <span><small>Executor</small><strong>{executor.kind === "tenki_github_actions"
          ? `${runnerProvider === "tenki" ? "Tenki Runner" : "GitHub-hosted fallback"} · ${executor.platform}`
          : "Tenki Sandbox"}</strong></span>
      </div>
      <div className="execution-profile-meta subtle">
        <span>Working directory <code>{config.workingDirectory}</code></span>
        <span>Version {profile.version}</span>
        <span title={profile.contentHash}>Hash <code>{compactHash(profile.contentHash)}</code></span>
        <span>{config.allowOutbound ? "Outbound network enabled" : "Network isolated"}</span>
        {actualRunnerLabel && <span>Runner <code>{actualRunnerLabel}</code></span>}
        {executor.kind === "tenki_github_actions" && <span>{executor.workflowSha256 ? <>Workflow <code>{compactHash(executor.workflowSha256)}</code></> : "Runner workflow awaiting installation"}</span>}
      </div>
      {runnerProvider === "github_hosted" && (
        <div className="callout">
          <div className="callout-title">GitHub-hosted compatibility fallback</div>
          <p className="subtle">{runnerEvidence?.fallbackReason ?? "This immutable profile predates verified Tenki runner inventory and resolves to a GitHub-hosted runner."}</p>
        </div>
      )}
      {commands.length > 0 && (
        <div className="execution-profile-commands" aria-label="Detected execution commands">
          {commands.map((command) => <code key={command}>{command}</code>)}
        </div>
      )}
    </div>
  );
}

function ProfileEditor({
  orgId,
  repository,
  workspaceRoot,
  profile,
  isAdmin,
  runtimeSecrets,
  runtimeSecretsLoading,
  runtimeSecretsError,
  managedEnvironments,
  onSaved,
}: {
  orgId: string;
  repository: string;
  workspaceRoot: string;
  profile: ExecutionProfileVersion;
  isAdmin: boolean;
  runtimeSecrets: RuntimeSecretMetadata[];
  runtimeSecretsLoading: boolean;
  runtimeSecretsError?: string;
  managedEnvironments: ManagedTenkiEnvironmentArtifact[];
  onSaved: (settings: ExecutionProfileSettingsView) => void;
}) {
  const [config, setConfig] = useState(() => structuredClone(profile.config));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const executor = executionProfileExecutor(config);
  const runnerProfile = executor.kind === "tenki_github_actions";
  const actualRunnerLabel = runnerProfile ? githubActionsRunnerLabel(executor) : null;
  const runnerProvider = actualRunnerLabel ? runnerProviderForLabel(actualRunnerLabel) : null;
  const inventorySelectedRunner = runnerProfile && !tenkiRunnerSize(executor.runnerLabel);
  const runnerEvidence = runnerSelectionEvidence(profile);
  const secretOptions = useMemo(
    () => runtimeSecretBindingOptions(runtimeSecrets, repository, workspaceRoot),
    [repository, runtimeSecrets, workspaceRoot],
  );
  const secretExposures: ExecutionProfileSecretBinding["exposure"][] = [
    "runtime",
    "test",
    "setup",
  ];
  const browserReadiness = config.schemaVersion !== 1 && !runnerProfile
    ? executionProfileBrowserReadiness(config)
    : null;
  const profileRuntimeFamily = runtimeFamilyForExecutionProfile(config);
  const detectedDependencyFingerprint = typeof profile.detectionEvidence
    ?.dependencyFingerprint === "string"
    ? profile.detectionEvidence.dependencyFingerprint
    : null;
  const eligibleManagedEnvironments = managedEnvironments.filter((artifact) =>
    artifact.status === "active"
    && artifact.approved
    && artifact.registryDigestRef
    && artifact.runtimeFamily === profileRuntimeFamily
    && (
      !artifact.packageManager
      || config.packageManager === "unknown"
      || artifact.packageManager === config.packageManager
    )
    && !runnerProfile
    && (
      config.schemaVersion === 1
      || !config.runtimeTools.browser
      || artifact.capabilities.includes("browser")
    )
    && (
      artifact.scopeType === "managed_toolchain"
      || (
        artifact.orgId === orgId
        && artifact.repository === repository
        && artifact.workspaceRoot === workspaceRoot
        && artifact.dependencyFingerprint === detectedDependencyFingerprint
      )
    ));

  function secretPhaseAvailable(
    environmentName: string,
    exposure: ExecutionProfileSecretBinding["exposure"],
    exceptIndex = -1,
  ): boolean {
    return config.schemaVersion === 1 || !config.secretBindings.some(
      (binding, index) => index !== exceptIndex
        && binding.envName === environmentName
        && binding.exposure === exposure,
    );
  }

  function change<Key extends keyof ExecutionProfileConfig>(
    key: Key,
    value: ExecutionProfileConfig[Key],
  ): void {
    setConfig((current) => ({ ...current, [key]: value }));
    setSaved(false);
    setError(undefined);
  }

  function enableRuntimeProfile(): void {
    setConfig((current) => upgradeExecutionProfileConfigV2(current));
    setSaved(false);
    setError(undefined);
  }

  function runtimeChange<Key extends keyof ExecutionProfileConfigV2>(
    key: Key,
    value: ExecutionProfileConfigV2[Key],
  ): void {
    setConfig((current) => ({
      ...(current.schemaVersion === 1 ? upgradeExecutionProfileConfigV2(current) : current),
      [key]: value,
    }));
    setSaved(false);
    setError(undefined);
  }

  function changeRunnerLabel(runnerLabel: string): void {
    if (config.schemaVersion !== 3 || executor.kind !== "tenki_github_actions") return;
    const size = tenkiRunnerSize(runnerLabel);
    if (!size || size.platform !== executor.platform) {
      setError(`Select a documented Tenki ${executor.platform} runner size.`);
      return;
    }
    setConfig((current) => current.schemaVersion === 3
      ? {
          ...current,
          cpuCores: size.cpuCores,
          memoryMb: size.memoryMb,
          executor: current.executor.kind === "tenki_github_actions"
            ? { ...current.executor, runnerLabel: size.label }
            : current.executor,
        }
      : current);
    setSaved(false);
    setError(undefined);
  }

  function changeInboundNetworking(enabled: boolean): void {
    setConfig((current) => current.schemaVersion !== 1
      ? { ...current, allowInbound: enabled, previewEnabled: enabled ? current.previewEnabled : false }
      : { ...current, allowInbound: enabled });
    setSaved(false);
    setError(undefined);
  }

  function changeOutboundNetworking(enabled: boolean): void {
    if (
      enabled
      && config.schemaVersion !== 1
      && config.secretBindings.some((binding) => binding.exposure === "runtime" || binding.exposure === "test")
    ) {
      setSaved(false);
      setError("Remove runtime and test secret bindings before enabling outbound access. Scoped egress policies are not available yet.");
      return;
    }
    change("allowOutbound", enabled);
  }

  function changeBrowserInteraction(enabled: boolean): void {
    if (config.schemaVersion === 1 || runnerProfile) return;
    const runtimeConfig = config;
    const result = configureBrowserInteraction(runtimeConfig, enabled);
    if (result.error) {
      setSaved(false);
      setError(result.error);
      return;
    }
    setConfig(result.config);
    setSaved(false);
    setError(undefined);
  }

  function replacePublicEnvironment(
    index: number,
    value: ExecutionProfilePublicEnvironmentVariable,
  ): void {
    if (config.schemaVersion === 1 || runnerProfile) return;
    runtimeChange("publicEnvironment", config.publicEnvironment.map(
      (current, currentIndex) => currentIndex === index ? value : current,
    ));
  }

  function removePublicEnvironment(index: number): void {
    if (config.schemaVersion === 1 || runnerProfile) return;
    runtimeChange(
      "publicEnvironment",
      config.publicEnvironment.filter((_, currentIndex) => currentIndex !== index),
    );
  }

  function replaceSecretBinding(index: number, token: string): void {
    if (config.schemaVersion === 1 || runnerProfile) return;
    const selected = secretOptions.find((option) => option.token === token);
    if (!selected) return;
    runtimeChange("secretBindings", config.secretBindings.map((binding, currentIndex) => currentIndex === index
      ? {
          ...binding,
          envName: selected.environmentName,
          secretId: selected.secretId,
          secretVersion: selected.secretVersion,
        }
      : binding));
  }

  function replaceSecretExposure(
    index: number,
    exposure: ExecutionProfileSecretBinding["exposure"],
  ): void {
    if (config.schemaVersion === 1 || runnerProfile) return;
    if (config.allowOutbound && exposure !== "setup") {
      setSaved(false);
      setError("Runtime and test secrets require a network-isolated profile. Disable outbound access first.");
      return;
    }
    const binding = config.secretBindings[index];
    if (!binding || !secretPhaseAvailable(binding.envName, exposure, index)) return;
    runtimeChange("secretBindings", config.secretBindings.map((binding, currentIndex) => currentIndex === index
      ? { ...binding, exposure }
      : binding));
  }

  function removeSecretBinding(index: number): void {
    if (config.schemaVersion === 1 || runnerProfile) return;
    runtimeChange("secretBindings", config.secretBindings.filter((_, currentIndex) => currentIndex !== index));
  }

  function addSecretBinding(): void {
    if (config.schemaVersion === 1 || runnerProfile) return;
    const eligibleExposures = config.allowOutbound
      ? secretExposures.filter((exposure) => exposure === "setup")
      : secretExposures;
    const selected = secretOptions
      .map((option) => ({
        option,
        exposure: eligibleExposures.find((exposure) => secretPhaseAvailable(option.environmentName, exposure)),
      }))
      .find((candidate) => candidate.exposure);
    if (!selected?.exposure) return;
    runtimeChange("secretBindings", [
      ...config.secretBindings,
      {
        envName: selected.option.environmentName,
        secretId: selected.option.secretId,
        secretVersion: selected.option.secretVersion,
        exposure: selected.exposure,
      },
    ]);
  }

  async function save(): Promise<void> {
    if (!isAdmin) return;
    if (config.tenkiImage && config.tenkiSnapshotId) {
      setError("Choose either a Tenki image or a snapshot, not both.");
      return;
    }
    setBusy(true);
    setSaved(false);
    setError(undefined);
    try {
      const response = await fetch("/api/settings/execution-profiles", {
        method: "PUT",
        headers: requestHeaders(orgId, true),
        body: JSON.stringify({
          repository,
          workspaceRoot,
          parentProfileId: profile.source === "safe_generic" && repository ? null : profile.id,
          config,
        }),
      });
      const payload = await response.json() as ApiResult;
      if (!response.ok || !payload.settings) {
        throw new Error(payload.error ?? "Execution profile could not be saved.");
      }
      onSaved(payload.settings);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Execution profile could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="execution-profile-editor">
      <summary>{profile.source === "safe_generic" ? "Configure override" : "Review & override"}</summary>
      <div className="execution-profile-editor-body">
        <div className="execution-profile-fields">
          <label className="field">Language
            <input value={config.language} disabled={!isAdmin} onChange={(event) => change("language", event.target.value)} />
          </label>
          <label className="field">Framework
            <input value={config.framework ?? ""} disabled={!isAdmin} placeholder="Optional" onChange={(event) => change("framework", event.target.value || null)} />
          </label>
          <label className="field">Package manager
            <input value={config.packageManager} disabled={!isAdmin} onChange={(event) => change("packageManager", event.target.value)} />
          </label>
          <label className="field">Runtime version
            <input value={config.runtimeVersion ?? ""} disabled={!isAdmin} placeholder="Optional" onChange={(event) => change("runtimeVersion", event.target.value || null)} />
          </label>
          <label className="field">Working directory
            <input value={config.workingDirectory} disabled={!isAdmin} onChange={(event) => change("workingDirectory", event.target.value)} />
          </label>
          <label className="field">Permitted paths
            <textarea rows={3} value={commandText(config.permittedPaths)} disabled={!isAdmin} onChange={(event) => change("permittedPaths", commandList(event.target.value))} />
            <small>One repository-relative glob per line. Ticket permissions can narrow this boundary.</small>
          </label>
        </div>
        <div className="execution-profile-command-grid">
          <label className="field">Install commands
            <textarea rows={3} value={commandText(config.installCommands)} disabled={!isAdmin} onChange={(event) => change("installCommands", commandList(event.target.value))} />
          </label>
          <label className="field">Build commands
            <textarea rows={3} value={commandText(config.buildCommands)} disabled={!isAdmin} onChange={(event) => change("buildCommands", commandList(event.target.value))} />
          </label>
          <label className="field">Test commands
            <textarea rows={3} value={commandText(config.testCommands)} disabled={!isAdmin} onChange={(event) => change("testCommands", commandList(event.target.value))} />
          </label>
          <label className="field">Typecheck commands
            <textarea rows={3} value={commandText(config.typecheckCommands)} disabled={!isAdmin} onChange={(event) => change("typecheckCommands", commandList(event.target.value))} />
          </label>
        </div>
        <section className="execution-profile-runtime" aria-labelledby={`runtime-${profile.id}`}>
          <div className="split">
            <div>
              <strong id={`runtime-${profile.id}`}>Running application</strong>
              <p className="subtle">Start this repository in Tenki so the agent can verify the approved story against a live app.</p>
            </div>
            {config.schemaVersion === 1 && (
              <button type="button" className="btn secondary" disabled={!isAdmin} onClick={enableRuntimeProfile}>
                Configure runtime
              </button>
            )}
          </div>
          {config.schemaVersion !== 1 && !runnerProfile && (
            <>
              <div className="execution-profile-network">
                <label className="toggle-row">
                  <div><strong>Run install automatically</strong><p className="subtle">Executes the reviewed install commands before the agent starts.</p></div>
                  <input type="checkbox" checked={config.automaticInstall} disabled={!isAdmin || config.installCommands.length === 0} onChange={(event) => runtimeChange("automaticInstall", event.target.checked)} />
                </label>
                <label className="toggle-row">
                  <div><strong>Run build automatically</strong><p className="subtle">Builds before initial start, restart, and independent verification.</p></div>
                  <input type="checkbox" checked={config.automaticBuild} disabled={!isAdmin || config.buildCommands.length === 0} onChange={(event) => runtimeChange("automaticBuild", event.target.checked)} />
                </label>
              </div>
              <div className="execution-profile-fields">
                <label className="field">Start command
                  <input value={config.startCommand ?? ""} disabled={!isAdmin} placeholder="pnpm start --hostname 0.0.0.0" onChange={(event) => runtimeChange("startCommand", event.target.value || null)} />
                </label>
                <label className="field">Application port
                  <input type="number" min="1024" max="65535" value={config.applicationPort ?? ""} disabled={!isAdmin} placeholder="3000" onChange={(event) => runtimeChange("applicationPort", event.target.value ? Number(event.target.value) : null)} />
                </label>
                <label className="field">Health-check path
                  <input value={config.healthCheckPath ?? ""} disabled={!isAdmin} placeholder="/api/health" onChange={(event) => runtimeChange("healthCheckPath", event.target.value || null)} />
                </label>
                <label className="field">Readiness timeout (seconds)
                  <input type="number" min="5" max="600" value={Math.round(config.healthCheckTimeoutMs / 1_000)} disabled={!isAdmin} onChange={(event) => runtimeChange("healthCheckTimeoutMs", Number(event.target.value) * 1_000)} />
                </label>
                <label className="field">Preview lifetime (minutes)
                  <input type="number" min="1" max="15" value={Math.round(config.previewTtlMs / 60_000)} disabled={!isAdmin} onChange={(event) => runtimeChange("previewTtlMs", Number(event.target.value) * 60_000)} />
                </label>
              </div>
              <div className="execution-profile-network">
                <label className="toggle-row">
                  <div><strong>HTTP interaction</strong><p className="subtle">Allow requests only to the configured localhost application.</p></div>
                  <input type="checkbox" checked={config.runtimeTools.http} disabled={!isAdmin} onChange={(event) => runtimeChange("runtimeTools", { ...config.runtimeTools, http: event.target.checked })} />
                </label>
                <label className="toggle-row">
                  <div>
                    <strong>Browser interaction</strong>
                    <p className="subtle" id={`browser-readiness-${profile.id}`}>
                      {config.runtimeTools.browser && browserReadiness
                        ? browserReadiness.reason
                        : "Provision Playwright and launch-test Chromium before the agent can use bounded browser actions."}
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={config.runtimeTools.browser}
                    disabled={!isAdmin}
                    aria-describedby={`browser-readiness-${profile.id}`}
                    onChange={(event) => changeBrowserInteraction(event.target.checked)}
                  />
                </label>
                <label className="toggle-row">
                  <div><strong>Short-lived preview URL</strong><p className="subtle">Expose only the configured port for the selected lifetime. Requires inbound networking.</p></div>
                  <input type="checkbox" checked={config.previewEnabled} disabled={!isAdmin || !config.allowInbound} onChange={(event) => runtimeChange("previewEnabled", event.target.checked)} />
                </label>
                <label className="toggle-row">
                  <div><strong>Runtime logs</strong><p className="subtle">Allow bounded, secret-redacted application log inspection.</p></div>
                  <input type="checkbox" checked={config.runtimeTools.logs} disabled={!isAdmin} onChange={(event) => runtimeChange("runtimeTools", { ...config.runtimeTools, logs: event.target.checked })} />
                </label>
              </div>
              <div className="execution-profile-runtime-env">
                <div className="split">
                  <div><strong>Public environment</strong><p className="subtle">Non-sensitive values stored in this immutable profile.</p></div>
                  <button type="button" className="btn secondary" disabled={!isAdmin || config.publicEnvironment.length >= 100} onClick={() => runtimeChange("publicEnvironment", [...config.publicEnvironment, { name: "APP_ENV", value: "" }])}>Add variable</button>
                </div>
                {config.publicEnvironment.map((item, index) => (
                  <div className="execution-profile-env-row" key={`${item.name}:${index}`}>
                    <input aria-label="Environment variable name" value={item.name} disabled={!isAdmin} onChange={(event) => replacePublicEnvironment(index, { ...item, name: event.target.value.toUpperCase() })} />
                    <input aria-label={`${item.name || "Environment"} value`} value={item.value} disabled={!isAdmin} onChange={(event) => replacePublicEnvironment(index, { ...item, value: event.target.value })} />
                    <button type="button" className="btn subtle" disabled={!isAdmin} onClick={() => removePublicEnvironment(index)}>Remove</button>
                  </div>
                ))}
                <div className="execution-profile-secret-bindings">
                  <div className="split">
                    <div>
                      <strong>Secret bindings</strong>
                      <p className="subtle">Pin an active vault version to one execution phase. Values are never copied into this profile.</p>
                    </div>
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={!isAdmin
                        || runtimeSecretsLoading
                        || Boolean(runtimeSecretsError)
                        || config.secretBindings.length >= 100
                        || !secretOptions.some((option) => secretExposures.some((exposure) => secretPhaseAvailable(option.environmentName, exposure)))}
                      onClick={addSecretBinding}
                    >
                      Add binding
                    </button>
                  </div>
                  {runtimeSecretsLoading && <p className="chatgpt-text-loading" role="status">Loading eligible secrets<span aria-hidden="true">…</span></p>}
                  {!runtimeSecretsLoading && runtimeSecretsError && (
                    <p className="subtle form-error" role="alert">Secret metadata is unavailable. Retry from the vault manager above before changing bindings.</p>
                  )}
                  {!runtimeSecretsLoading && !runtimeSecretsError && secretOptions.length === 0 && config.secretBindings.length === 0 && (
                    <div className="execution-profile-secret-empty">
                      <strong>No active secret is eligible for this scope</strong>
                      <p className="subtle">Create a workspace secret or an exact <code>{repository || "workspace"}</code> · <code>{workspaceRoot}</code> secret in the vault above.</p>
                    </div>
                  )}
                  {config.secretBindings.map((binding: ExecutionProfileSecretBinding, index) => {
                    const currentToken = `${binding.secretId}:${binding.secretVersion}`;
                    const referencedSecret = runtimeSecrets.find((secret) => secret.id === binding.secretId);
                    const referencedVersion = referencedSecret?.versions.find((version) => version.version === binding.secretVersion);
                    const scopeEligible = referencedSecret?.scopeType === "workspace"
                      || (referencedSecret?.repository === repository && referencedSecret?.workspaceRoot === workspaceRoot);
                    const referenceActive = Boolean(referencedVersion?.active && scopeEligible);
                    const phasesBoundElsewhere = new Set(config.secretBindings
                      .filter((_, bindingIndex) => bindingIndex !== index)
                      .map((current) => `${current.exposure}:${current.envName}`));
                    const rowOptions = secretOptions.filter((option) => option.environmentName === binding.envName
                      || !phasesBoundElsewhere.has(`${binding.exposure}:${option.environmentName}`));
                    return (
                      <div className="execution-profile-secret-row" key={`${binding.envName}:${binding.secretId}:${binding.secretVersion}:${index}`}>
                        <label className="field">Vault version
                          <select value={currentToken} disabled={!isAdmin || runtimeSecretsLoading || Boolean(runtimeSecretsError)} onChange={(event) => replaceSecretBinding(index, event.target.value)}>
                            {!rowOptions.some((option) => option.token === currentToken) && (
                              <option value={currentToken}>{binding.envName} · v{binding.secretVersion} · unavailable</option>
                            )}
                            {rowOptions.map((option) => (
                              <option value={option.token} key={option.token}>
                                {option.environmentName} · {option.label} · v{option.secretVersion} · {option.scopeType === "workspace" ? "workspace" : "repository"}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">Available during
                          <select value={binding.exposure} disabled={!isAdmin} onChange={(event) => replaceSecretExposure(index, event.target.value as ExecutionProfileSecretBinding["exposure"])}>
                            <option value="setup" disabled={!secretPhaseAvailable(binding.envName, "setup", index)}>Setup · install and build</option>
                            <option value="runtime" disabled={config.allowOutbound || !secretPhaseAvailable(binding.envName, "runtime", index)}>Runtime · running application</option>
                            <option value="test" disabled={config.allowOutbound || !secretPhaseAvailable(binding.envName, "test", index)}>Test · acceptance verification</option>
                          </select>
                        </label>
                        <div className="execution-profile-secret-state">
                          <span className={`badge ${referenceActive ? "success" : "high"}`}>{runtimeSecretsError ? "Metadata unavailable" : referenceActive ? "Active reference" : referencedVersion?.active ? "Scope mismatch" : "Revoked or missing"}</span>
                          <button type="button" className="btn subtle" disabled={!isAdmin} onClick={() => removeSecretBinding(index)}>Remove</button>
                        </div>
                      </div>
                    );
                  })}
                  {config.secretBindings.length > 0 && (
                    <p className="subtle">Rotating a vault value creates a new version. This profile stays pinned until you select the new active version and save another immutable profile version.</p>
                  )}
                </div>
              </div>
            </>
          )}
          {runnerProfile && (
            <div className="callout">
              <div className="callout-title">GitHub Actions execution runner</div>
              <p className="subtle">
                Provider <strong>{runnerProvider === "tenki" ? "Tenki" : "GitHub-hosted fallback"}</strong> · platform <code>{executor.platform}</code> · architecture <code>{executor.architecture}</code> · runner <code>{actualRunnerLabel}</code>
              </p>
              {runnerProvider === "github_hosted" && runnerEvidence?.fallbackReason && <p className="subtle">Fallback reason: {runnerEvidence.fallbackReason}</p>}
              <p className="subtle">
                Workflow <code>{executor.workflowPath}</code> · {executor.workflowSha256 ? <>SHA-256 <code>{compactHash(executor.workflowSha256)}</code></> : "Install and verify this workflow before activation."}
              </p>
              <label className="field">Runner selection
                <select
                  value={executor.runnerLabel}
                  disabled={!isAdmin || inventorySelectedRunner}
                  onChange={(event) => changeRunnerLabel(event.target.value)}
                >
                  {inventorySelectedRunner && (
                    <option value={executor.runnerLabel}>{executor.runnerLabel} · inventory selected</option>
                  )}
                  {tenkiRunnerSizesForPlatform(executor.platform).map((size) => (
                    <option key={size.label} value={size.label}>
                      {size.label} · {size.cpuCores} CPU · {Math.round(size.memoryMb / 1_024)} GB
                    </option>
                  ))}
                </select>
                <small>{inventorySelectedRunner
                  ? "CloseSpan selected this exact enabled runner after platform and toolchain compatibility matching. Refresh repository detection after changing the Tenki catalog."
                  : "This legacy profile uses a capacity selector. Refresh repository detection to replace it with an exact enabled runner label."}</small>
              </label>
              {executor.xcode && <p className="subtle">Xcode {executor.xcode.version} · <code>{executor.xcode.containerPath}</code> · scheme <code>{executor.xcode.scheme}</code> · {executor.xcode.destination}</p>}
              {executor.androidEmulator && <p className="subtle">Android API {executor.androidEmulator.apiLevel} · {executor.androidEmulator.deviceProfile} · <code>{executor.androidEmulator.gradleTask}</code> · nested KVM required</p>}
            </div>
          )}
        </section>
        <div className="execution-profile-fields execution-profile-resource-fields">
          <label className="field">CPU cores
            <input type="number" min="1" max="16" value={config.cpuCores} disabled={!isAdmin || runnerProfile} onChange={(event) => change("cpuCores", Number(event.target.value))} />
          </label>
          <label className="field">Memory (MB)
            <input type="number" min="512" max="65536" step="512" value={config.memoryMb} disabled={!isAdmin || runnerProfile} onChange={(event) => change("memoryMb", Number(event.target.value))} />
          </label>
          <label className="field">Requested max duration (minutes)
            <input type="number" min="1" max="1440" value={Math.round(config.maxDurationMs / 60_000)} disabled={!isAdmin} onChange={(event) => change("maxDurationMs", Number(event.target.value) * 60_000)} />
            <small>Stored in the immutable profile. The current hosted executor applies a stricter 4-minute implementation and 3-minute verification ceiling.</small>
          </label>
          <label className="field">Idle timeout (minutes)
            <input type="number" min="1" max="1440" value={config.idleTimeoutMinutes} disabled={!isAdmin} onChange={(event) => change("idleTimeoutMinutes", Number(event.target.value))} />
          </label>
          <label className="field">Managed Tenki environment
            <select
              value={config.tenkiImage ?? ""}
              disabled={!isAdmin || runnerProfile}
              onChange={(event) => {
                change("tenkiImage", event.target.value || null);
                change("tenkiSnapshotId", null);
              }}
            >
              <option value="" disabled>Select a managed environment</option>
              {eligibleManagedEnvironments.map((artifact) => (
                <option key={artifact.id} value={artifact.registryDigestRef ?? ""}>
                  {artifact.catalogKey} · v{artifact.version} · {artifact.scopeType === "repository_private" ? "Private repository" : "CloseSpan managed"}
                </option>
              ))}
            </select>
            <small>{runnerProfile ? "Runner profiles bind a workflow digest and runner label instead of a Sandbox image." : "Only active, validated, digest-pinned environments from the CloseSpan catalog can be selected. Raw snapshot IDs and mutable image tags are rejected."}</small>
          </label>
        </div>
        <div className="execution-profile-network">
          <label className="toggle-row">
            <div><strong>Outbound network</strong><p className="subtle">Keep disabled unless this exact profile needs external access.</p></div>
            <input type="checkbox" checked={config.allowOutbound} disabled={!isAdmin} onChange={(event) => changeOutboundNetworking(event.target.checked)} />
          </label>
          <label className="toggle-row">
            <div><strong>Inbound network</strong><p className="subtle">Disabled by default for isolated agent runs.</p></div>
            <input type="checkbox" checked={config.allowInbound} disabled={!isAdmin || runnerProfile} onChange={(event) => changeInboundNetworking(event.target.checked)} />
          </label>
        </div>
        <div className="ai-config-actions">
          <button type="button" className="btn primary" disabled={!isAdmin || busy} onClick={save}>
            {busy ? "Saving version…" : "Save immutable version"}
          </button>
          {saved && <span className="badge success" role="status">Profile saved</span>}
          {error && <span className="subtle form-error" role="alert">{error}</span>}
        </div>
      </div>
    </details>
  );
}

function assignmentForWorkspace(assignments: ExecutionProfileAssignmentView[]) {
  return assignments.find((assignment) => assignment.repository === "") ?? null;
}

export function selectedExecutionRepository(
  repositories: GithubRepositoryAuthorization[],
  requestedRepository: string,
): GithubRepositoryAuthorization | undefined {
  const activeRepositories = repositories.filter(
    (repository) => repository.active && repository.workspaceSelected,
  );
  return activeRepositories.find((repository) => repository.repository === requestedRepository)
    ?? activeRepositories[0];
}

export function ExecutionProfileSettings({
  orgId,
  isAdmin,
}: {
  orgId: string;
  isAdmin: boolean;
}) {
  const [view, setView] = useState<ExecutionProfileApiView>();
  const [loading, setLoading] = useState(isAdmin);
  const [busyRepository, setBusyRepository] = useState<string>();
  const [busyRunnerRepository, setBusyRunnerRepository] = useState<string>();
  const [busyRunnerMergeRepository, setBusyRunnerMergeRepository] = useState<string>();
  const [runnerWorkflowPulls, setRunnerWorkflowPulls] = useState<Record<string, RunnerWorkflowPullRequest>>({});
  const [runnerWorkflowNotices, setRunnerWorkflowNotices] = useState<Record<string, string>>({});
  const [repositoryActionErrors, setRepositoryActionErrors] = useState<Record<string, string>>({});
  const [busyProfile, setBusyProfile] = useState<string>();
  const [busyDeactivation, setBusyDeactivation] = useState<string>();
  const [busyExecutionBranch, setBusyExecutionBranch] = useState<string>();
  const [executionBranches, setExecutionBranches] = useState<Record<string, string>>({});
  const [selectedRepositoryName, setSelectedRepositoryName] = useState("");
  const [error, setError] = useState<string>();
  const [runtimeSecrets, setRuntimeSecrets] = useState<RuntimeSecretMetadata[]>([]);
  const [runtimeSecretsLoading, setRuntimeSecretsLoading] = useState(isAdmin);
  const [runtimeSecretsError, setRuntimeSecretsError] = useState<string>();

  const refreshRuntimeSecrets = useCallback(async (signal?: AbortSignal): Promise<void> => {
    if (!isAdmin) return;
    await Promise.resolve();
    if (signal?.aborted) return;
    setRuntimeSecretsLoading(true);
    setRuntimeSecretsError(undefined);
    try {
      setRuntimeSecrets(await loadRuntimeSecretMetadata(orgId, signal));
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setRuntimeSecretsError(cause instanceof Error ? cause.message : "Runtime secret metadata could not be loaded.");
    } finally {
      if (!signal?.aborted) setRuntimeSecretsLoading(false);
    }
  }, [isAdmin, orgId]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    fetch("/api/settings/execution-profiles", {
      headers: requestHeaders(orgId),
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await response.json() as ExecutionProfileApiView & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Execution profiles could not be loaded.");
        return payload;
      })
      .then((payload) => {
        if (!cancelled) {
          setView(payload);
          setRunnerWorkflowPulls(Object.fromEntries(
            (payload.runnerWorkflowSetups ?? []).map((setup) => [
              setup.repository,
              { number: setup.pullRequestNumber, url: setup.pullRequestUrl },
            ]),
          ));
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Execution profiles could not be loaded.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [isAdmin, orgId]);

  useEffect(() => {
    if (!isAdmin) return;
    const controller = new AbortController();
    loadRuntimeSecretMetadata(orgId, controller.signal)
      .then((secrets) => {
        if (!controller.signal.aborted) setRuntimeSecrets(secrets);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        if (!controller.signal.aborted) {
          setRuntimeSecretsError(cause instanceof Error ? cause.message : "Runtime secret metadata could not be loaded.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setRuntimeSecretsLoading(false);
      });
    return () => controller.abort();
  }, [isAdmin, orgId]);

  const assignmentsByRepository = useMemo(() => {
    const grouped = new Map<string, ExecutionProfileAssignmentView[]>();
    for (const assignment of view?.assignments ?? []) {
      if (!assignment.repository) continue;
      grouped.set(assignment.repository, [
        ...(grouped.get(assignment.repository) ?? []),
        assignment,
      ]);
    }
    return grouped;
  }, [view]);

  function applySettings(settings: ExecutionProfileSettingsView): void {
    setView((current) => current ? { ...current, ...settings } : current);
  }

  function applyRuntimeSecret(secret: RuntimeSecretMetadata): void {
    setRuntimeSecrets((current) => [
      ...current.filter((item) => item.id !== secret.id),
      secret,
    ].sort((left, right) => left.environmentName.localeCompare(right.environmentName)));
  }

  async function detect(repository: string): Promise<boolean> {
    if (!isAdmin) return false;
    setBusyRepository(repository);
    setRepositoryActionErrors((current) => {
      const next = { ...current };
      delete next[repository];
      return next;
    });
    try {
      const response = await fetch("/api/settings/execution-profiles/detect", {
        method: "POST",
        headers: requestHeaders(orgId, true),
        body: JSON.stringify({ repository }),
      });
      const payload = await response.json() as ApiResult;
      if (!response.ok || !payload.settings) throw new Error(payload.error ?? "Repository detection failed.");
      applySettings(payload.settings);
      return true;
    } catch (cause) {
      setRepositoryActionErrors((current) => ({
        ...current,
        [repository]: cause instanceof Error ? cause.message : "Repository detection failed.",
      }));
      return false;
    } finally {
      setBusyRepository(undefined);
    }
  }

  async function confirm(profileId: string, repository: GithubRepositoryAuthorization): Promise<void> {
    if (!isAdmin) return;
    setBusyProfile(profileId);
    setRepositoryActionErrors((current) => {
      const next = { ...current };
      delete next[repository.repository];
      return next;
    });
    try {
      const response = await fetch("/api/settings/execution-profiles/confirm", {
        method: "POST",
        headers: requestHeaders(orgId, true),
        body: JSON.stringify({
          detectedProfileId: profileId,
          executionBranch: executionBranches[repository.repository]
            ?? repository.executionBranch
            ?? repository.defaultBranch,
        }),
      });
      const payload = await response.json() as ApiResult;
      if (!response.ok || !payload.settings) throw new Error(payload.error ?? "Execution profile could not be confirmed.");
      applySettings(payload.settings);
    } catch (cause) {
      setRepositoryActionErrors((current) => ({
        ...current,
        [repository.repository]: cause instanceof Error
          ? cause.message
          : "Execution profile could not be confirmed.",
      }));
    } finally {
      setBusyProfile(undefined);
    }
  }

  async function deactivate(repository: string, workspaceRoot: string): Promise<void> {
    if (!isAdmin) return;
    const scope = `${repository}:${workspaceRoot}`;
    setBusyDeactivation(scope);
    setRepositoryActionErrors((current) => {
      const next = { ...current };
      delete next[repository];
      return next;
    });
    try {
      const response = await fetch("/api/settings/execution-profiles", {
        method: "DELETE",
        headers: requestHeaders(orgId, true),
        body: JSON.stringify({ repository, workspaceRoot }),
      });
      const payload = await response.json() as ApiResult;
      if (!response.ok || !payload.settings) {
        throw new Error(payload.error ?? "Execution profile could not be deactivated.");
      }
      applySettings(payload.settings);
    } catch (cause) {
      setRepositoryActionErrors((current) => ({
        ...current,
        [repository]: cause instanceof Error ? cause.message : "Execution profile could not be deactivated.",
      }));
    } finally {
      setBusyDeactivation(undefined);
    }
  }

  async function saveExecutionBranch(repository: GithubRepositoryAuthorization): Promise<void> {
    if (!isAdmin) return;
    setBusyExecutionBranch(repository.repository);
    setRepositoryActionErrors((current) => {
      const next = { ...current };
      delete next[repository.repository];
      return next;
    });
    try {
      const response = await fetch("/api/settings/execution-profiles", {
        method: "PATCH",
        headers: requestHeaders(orgId, true),
        body: JSON.stringify({
          repository: repository.repository,
          executionBranch: executionBranches[repository.repository]
            ?? repository.executionBranch
            ?? repository.defaultBranch,
        }),
      });
      const payload = await response.json() as { error?: string; executionBranch?: string };
      if (!response.ok || !payload.executionBranch) {
        throw new Error(payload.error ?? "Execution branch could not be saved.");
      }
      setView((current) => current ? {
        ...current,
        repositories: current.repositories.map((item) => item.repository === repository.repository
          ? { ...item, executionBranch: payload.executionBranch! }
          : item),
      } : current);
    } catch (cause) {
      setRepositoryActionErrors((current) => ({
        ...current,
        [repository.repository]: cause instanceof Error
          ? cause.message
          : "Execution branch could not be saved.",
      }));
    } finally {
      setBusyExecutionBranch(undefined);
    }
  }

  async function installRunnerWorkflow(repository: string): Promise<void> {
    if (!isAdmin) return;
    setBusyRunnerRepository(repository);
    setRepositoryActionErrors((current) => {
      const next = { ...current };
      delete next[repository];
      return next;
    });
    try {
      const response = await fetch(
        "/api/settings/execution-profiles/install-runner-workflow",
        {
          method: "POST",
          headers: requestHeaders(orgId, true),
          body: JSON.stringify({ repository }),
        },
      );
      const payload = await response.json() as RunnerWorkflowInstallationResult;
      if (!response.ok || !payload.status) {
        throw new Error(payload.error ?? "The Tenki workflows could not be installed.");
      }
      if (payload.pullRequestUrl && payload.pullRequestNumber) {
        setRunnerWorkflowPulls((current) => ({
          ...current,
          [repository]: {
            number: payload.pullRequestNumber!,
            url: payload.pullRequestUrl!,
          },
        }));
        setRunnerWorkflowNotices((current) => {
          const next = { ...current };
          delete next[repository];
          return next;
        });
      } else {
        const detectionRefreshed = await detect(repository);
        setRunnerWorkflowNotices((current) => ({
          ...current,
          [repository]: detectionRefreshed
            ? "The Tenki workflows are already installed. Repository detection has been refreshed."
            : "The Tenki workflows are installed, but repository detection still needs to be refreshed.",
        }));
      }
    } catch (cause) {
      setRepositoryActionErrors((current) => ({
        ...current,
        [repository]: cause instanceof Error ? cause.message : "The Tenki workflows could not be installed.",
      }));
    } finally {
      setBusyRunnerRepository(undefined);
    }
  }

  async function approveAndMergeRunnerWorkflow(repository: string): Promise<void> {
    if (!isAdmin) return;
    const pullRequest = runnerWorkflowPulls[repository];
    if (!pullRequest) return;
    setBusyRunnerMergeRepository(repository);
    setRepositoryActionErrors((current) => {
      const next = { ...current };
      delete next[repository];
      return next;
    });
    try {
      const response = await fetch(
        "/api/settings/execution-profiles/approve-runner-workflow",
        {
          method: "POST",
          headers: requestHeaders(orgId, true),
          body: JSON.stringify({
            repository,
            pullRequestNumber: pullRequest.number,
          }),
        },
      );
      const payload = await response.json() as RunnerWorkflowMergeResult;
      if (!response.ok || !payload.status || !payload.mergedSha) {
        throw new Error(payload.error ?? "The runner setup pull request could not be merged.");
      }
      setRunnerWorkflowPulls((current) => {
        const next = { ...current };
        delete next[repository];
        return next;
      });
      const detectionRefreshed = await detect(repository);
      const checks = payload.githubActionsChecksPassed ?? 0;
      const checkSummary = checks > 0
        ? `after ${checks} reported GitHub Actions ${checks === 1 ? "check" : "checks"} passed`
        : "with no GitHub Actions checks reported";
      setRunnerWorkflowNotices((current) => ({
        ...current,
        [repository]: payload.status === "installed"
          ? detectionRefreshed
            ? "The Tenki workflows were already installed. Repository detection has been refreshed."
            : "The Tenki workflows were already installed, but repository detection still needs to be refreshed."
          : `Tenki setup merged ${checkSummary}. ${detectionRefreshed ? "Repository detection has been refreshed." : "Refresh repository detection to finish binding the implementation workflow."}`,
      }));
    } catch (cause) {
      setRepositoryActionErrors((current) => ({
        ...current,
        [repository]: cause instanceof Error
          ? cause.message
          : "The runner setup pull request could not be merged.",
      }));
    } finally {
      setBusyRunnerMergeRepository(undefined);
    }
  }

  if (loading) {
    return <p className="chatgpt-text-loading" role="status">Loading execution profiles<span aria-hidden="true">…</span></p>;
  }
  if (!isAdmin) {
    return <div className="callout"><div className="callout-title">Workspace admin access required</div><p className="subtle">Execution profiles and runtime secret metadata are restricted to workspace administrators.</p></div>;
  }
  if (error && !view) return <div className="toast error" role="alert">{error}</div>;
  if (!view?.available) {
    return <div className="callout"><div className="callout-title">Persistent workspace required</div><p className="subtle">Execution profiles are available for production workspaces backed by PostgreSQL.</p></div>;
  }

  const workspaceAssignment = assignmentForWorkspace(view.assignments);
  const workspaceProfile = workspaceAssignment?.activeProfile ?? view.safeGenericProfile;
  const activeRepositories = view.repositories.filter(
    (repository) => repository.active && repository.workspaceSelected,
  );
  const selectedRepository = selectedExecutionRepository(view.repositories, selectedRepositoryName);
  const displayedRepositories = selectedRepository ? [selectedRepository] : [];
  return (
    <div className="execution-profile-settings">
      {error && <div className="toast error" role="alert">{error}</div>}
      <div className="callout">
        <div className="callout-title">Profiles are immutable execution contracts</div>
        <p className="subtle">The latest high-confidence, execution-ready detection activates automatically. Administrators can deactivate a repository root to stop future automatic activation. The selected profile ID, version, hash, and full snapshot are bound to Prompt Testing, approval, implementation, and independent verification.</p>
      </div>

      <RuntimeSecretManager
        orgId={orgId}
        secrets={runtimeSecrets}
        repositories={view.repositories}
        loading={runtimeSecretsLoading}
        error={runtimeSecretsError}
        onRetry={() => { void refreshRuntimeSecrets(); }}
        onChanged={applyRuntimeSecret}
      />

      <article className="execution-profile-scope">
        <div className="execution-profile-scope-head">
          <div><span className="eyebrow">Workspace fallback</span><h3>Default execution profile</h3><p className="subtle">Used only when a repository or ticket does not have a more specific active profile.</p></div>
          <span className={`badge ${workspaceAssignment?.activeProfile ? "success" : ""}`}>{profileLabel(workspaceProfile)}</span>
        </div>
        <ProfileSummary profile={workspaceProfile} />
        <ProfileEditor
          key={`workspace-${workspaceProfile.id}`}
          orgId={orgId}
          repository=""
          workspaceRoot="."
          profile={workspaceProfile}
          isAdmin={isAdmin}
          runtimeSecrets={runtimeSecrets}
          runtimeSecretsLoading={runtimeSecretsLoading}
          runtimeSecretsError={runtimeSecretsError}
          managedEnvironments={view.managedEnvironments ?? []}
          onSaved={applySettings}
        />
      </article>

      <div className="execution-profile-repositories">
        {displayedRepositories.map((repository) => {
          const assignments = assignmentsByRepository.get(repository.repository) ?? [];
          const needsRunnerWorkflow = assignments.some((assignment) => {
            const profile = assignment.detectedProfile ?? assignment.activeProfile;
            return profile
              ? executionProfileExecutor(profile.config).kind === "tenki_github_actions"
              : false;
          });
          return (
            <article className="execution-profile-scope" key={repository.id}>
              <div className="execution-profile-scope-head">
                <div>
                  <span className="eyebrow">Authorized repository</span>
                  {activeRepositories.length > 1 ? (
                    <CustomSelect
                      ariaLabel="Repository to manage"
                      className="execution-profile-repository-select"
                      leadingIcon={<Github aria-hidden="true" size={16} strokeWidth={2} />}
                      options={activeRepositories.map((activeRepository) => ({
                        label: activeRepository.repository,
                        value: activeRepository.repository,
                      }))}
                      value={repository.repository}
                      onValueChange={setSelectedRepositoryName}
                    />
                  ) : (
                    <h3>{repository.repository}</h3>
                  )}
                  <p className="subtle">Default branch <code>{repository.defaultBranch}</code> · runtime verification pins the selected execution branch to an exact commit SHA</p>
                  <label className="field execution-branch-field">
                    <span>Execution branch</span>
                    <span className="execution-branch-control">
                      <input
                        value={executionBranches[repository.repository] ?? repository.executionBranch ?? repository.defaultBranch}
                        onChange={(event) => setExecutionBranches((current) => ({
                          ...current,
                          [repository.repository]: event.target.value,
                        }))}
                        disabled={!isAdmin || Boolean(busyProfile) || busyExecutionBranch === repository.repository}
                        aria-label={`Execution branch for ${repository.repository}`}
                        maxLength={255}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                      />
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={!isAdmin || Boolean(busyProfile) || Boolean(busyExecutionBranch)}
                        onClick={() => saveExecutionBranch(repository)}
                      >
                        {busyExecutionBranch === repository.repository ? "Checking…" : "Use branch"}
                      </button>
                    </span>
                    <small>New verification runs use the latest exact commit from this branch.</small>
                  </label>
                </div>
                <div className="top-actions">
                  {needsRunnerWorkflow && (
                    <button type="button" className="btn secondary" disabled={!isAdmin || Boolean(busyRunnerRepository) || Boolean(busyRunnerMergeRepository)} onClick={() => installRunnerWorkflow(repository.repository)}>
                      {busyRunnerRepository === repository.repository ? "Preparing workflows…" : "Install Tenki workflows"}
                    </button>
                  )}
                  <button type="button" className="btn secondary" disabled={!isAdmin || Boolean(busyRepository) || Boolean(busyRunnerMergeRepository)} onClick={() => detect(repository.repository)}>
                    {busyRepository === repository.repository ? "Detecting…" : assignments.length ? "Refresh detection" : "Detect configuration"}
                  </button>
                </div>
              </div>
              {repositoryActionErrors[repository.repository] && (
                <div className="toast error runner-workflow-error" role="alert">
                  <span>{repositoryActionErrors[repository.repository]}</span>
                  {runnerWorkflowPulls[repository.repository] && (
                    <a
                      className="btn secondary runner-workflow-review-button"
                      href={runnerWorkflowPulls[repository.repository].url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Review failing checks
                    </a>
                  )}
                </div>
              )}
              {runnerWorkflowNotices[repository.repository] && (
                <div className="callout success runner-workflow-notice" role="status">
                  <div className="callout-title">Tenki workflows installed</div>
                  <p>{runnerWorkflowNotices[repository.repository]}</p>
                </div>
              )}
              {runnerWorkflowPulls[repository.repository] && (
                <div className="callout runner-workflow-approval" aria-live="polite">
                  <div className="callout-title">Runner setup is ready for your approval</div>
                  <p>
                    CloseSpan will recheck the exact pull request commit, allow only the reviewed implementation and runtime-verifier workflow files, and require every reported GitHub Actions run to pass. Your approval merges the setup pull request; CloseSpan never commits it directly to the default branch.
                  </p>
                  <div className="top-actions">
                    <button
                      type="button"
                      className="btn primary"
                      disabled={!isAdmin || Boolean(busyRunnerMergeRepository) || Boolean(busyRunnerRepository)}
                      onClick={() => approveAndMergeRunnerWorkflow(repository.repository)}
                    >
                      {busyRunnerMergeRepository === repository.repository
                        ? "Verifying checks and merging…"
                        : "Approve and merge runner setup"}
                    </button>
                    <a
                      className="btn secondary"
                      href={runnerWorkflowPulls[repository.repository].url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Review setup pull request
                    </a>
                  </div>
                </div>
              )}
              {assignments.length === 0 ? (
                <div className="execution-profile-empty">
                  <strong>No repository profile yet</strong>
                  <p className="subtle">Run bounded manifest detection, then review the proposed roots and commands before activation.</p>
                  <ProfileEditor
                    key={`manual-${repository.repository}`}
                    orgId={orgId}
                    repository={repository.repository}
                    workspaceRoot="."
                    profile={view.safeGenericProfile}
                    isAdmin={isAdmin}
                    runtimeSecrets={runtimeSecrets}
                    runtimeSecretsLoading={runtimeSecretsLoading}
                    runtimeSecretsError={runtimeSecretsError}
                    managedEnvironments={view.managedEnvironments ?? []}
                    onSaved={applySettings}
                  />
                </div>
              ) : assignments.map((assignment) => {
                const shown = assignment.activeProfile ?? assignment.detectedProfile;
                if (!shown) return null;
                const detectedCompatibility = assignment.detectedProfile
                  ? view.compatibilityByProfileId?.[assignment.detectedProfile.id]
                  : undefined;
                const shownCompatibility = view.compatibilityByProfileId?.[shown.id];
                return (
                  <div className="execution-profile-root" key={`${assignment.repository}:${assignment.workspaceRoot}`}>
                    <div className="split">
                      <div>
                        <strong>Root <code>{assignment.workspaceRoot}</code></strong>
                        <p className="subtle">
                          {assignment.activeProfile
                            ? profileLabel(assignment.activeProfile)
                            : assignment.automaticActivationDisabled
                              ? "Deactivated by an administrator"
                              : shownCompatibility?.summary ?? "Validating compatibility in the background"}
                        </p>
                        {shownCompatibility?.detail && (
                          <small className="subtle">{shownCompatibility.detail}</small>
                        )}
                      </div>
                      <div className="top-actions">
                        {assignment.activeProfile && <span className="badge success">Active</span>}
                        {assignment.activeProfile && (
                          <button type="button" className="btn secondary" disabled={!isAdmin || Boolean(busyDeactivation)} onClick={() => deactivate(assignment.repository, assignment.workspaceRoot)}>
                            {busyDeactivation === `${assignment.repository}:${assignment.workspaceRoot}` ? "Deactivating…" : "Deactivate"}
                          </button>
                        )}
                        {assignment.detectedProfile && (
                          <button
                            type="button"
                            className="btn secondary"
                            disabled={
                              !isAdmin
                              || Boolean(busyProfile)
                              || detectedCompatibility?.status !== "compatible"
                            }
                            title={detectedCompatibility?.status !== "compatible"
                              ? detectedCompatibility?.detail ?? "Compatibility validation is still running"
                              : undefined}
                            onClick={() => confirm(assignment.detectedProfile!.id, repository)}
                          >
                            {busyProfile === assignment.detectedProfile.id ? "Activating…" : assignment.activeProfile ? "Activate detected update" : "Activate"}
                          </button>
                        )}
                      </div>
                    </div>
                    <ProfileSummary profile={shown} />
                    <ProfileEditor
                      key={shown.id}
                      orgId={orgId}
                      repository={assignment.repository}
                      workspaceRoot={assignment.workspaceRoot}
                      profile={shown}
                      isAdmin={isAdmin}
                      runtimeSecrets={runtimeSecrets}
                      runtimeSecretsLoading={runtimeSecretsLoading}
                      runtimeSecretsError={runtimeSecretsError}
                      managedEnvironments={view.managedEnvironments ?? []}
                      onSaved={applySettings}
                    />
                  </div>
                );
              })}
            </article>
          );
        })}
        {activeRepositories.length === 0 && (
          <div className="empty-state execution-profile-no-repositories">
            <strong>Connect a GitHub repository first</strong>
            <p className="subtle">Install the CloseSpan GitHub App and explicitly authorize repositories before creating execution profiles.</p>
          </div>
        )}
      </div>
    </div>
  );
}
