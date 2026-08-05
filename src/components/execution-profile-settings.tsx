"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  ExecutionProfileAssignmentView,
  ExecutionProfileSettingsView,
} from "@/lib/execution-profile-repository";
import type {
  ExecutionProfileConfig,
  ExecutionProfileVersion,
} from "@/lib/execution-profile";
import type { GithubRepositoryAuthorization } from "@/lib/github-repository-allowlist";

interface ExecutionProfileApiView extends ExecutionProfileSettingsView {
  available: boolean;
  repositories: GithubRepositoryAuthorization[];
}

interface ApiResult {
  error?: string;
  settings?: ExecutionProfileSettingsView;
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

function commandText(commands: string[]): string {
  return commands.join("\n");
}

function commandList(value: string): string[] {
  return value
    .split("\n")
    .map((command) => command.trim())
    .filter(Boolean);
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

function ProfileSummary({ profile }: { profile: ExecutionProfileVersion }) {
  const config = profile.config;
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
      </div>
      <div className="execution-profile-meta subtle">
        <span>Working directory <code>{config.workingDirectory}</code></span>
        <span>Version {profile.version}</span>
        <span title={profile.contentHash}>Hash <code>{compactHash(profile.contentHash)}</code></span>
        <span>{config.allowOutbound ? "Outbound network enabled" : "Network isolated"}</span>
      </div>
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
  onSaved,
}: {
  orgId: string;
  repository: string;
  workspaceRoot: string;
  profile: ExecutionProfileVersion;
  isAdmin: boolean;
  onSaved: (settings: ExecutionProfileSettingsView) => void;
}) {
  const [config, setConfig] = useState(() => structuredClone(profile.config));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  function change<Key extends keyof ExecutionProfileConfig>(
    key: Key,
    value: ExecutionProfileConfig[Key],
  ): void {
    setConfig((current) => ({ ...current, [key]: value }));
    setSaved(false);
    setError(undefined);
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
        <div className="execution-profile-fields execution-profile-resource-fields">
          <label className="field">CPU cores
            <input type="number" min="1" max="32" value={config.cpuCores} disabled={!isAdmin} onChange={(event) => change("cpuCores", Number(event.target.value))} />
          </label>
          <label className="field">Memory (MB)
            <input type="number" min="512" max="131072" step="512" value={config.memoryMb} disabled={!isAdmin} onChange={(event) => change("memoryMb", Number(event.target.value))} />
          </label>
          <label className="field">Requested max duration (minutes)
            <input type="number" min="1" max="1440" value={Math.round(config.maxDurationMs / 60_000)} disabled={!isAdmin} onChange={(event) => change("maxDurationMs", Number(event.target.value) * 60_000)} />
            <small>Stored in the immutable profile. The current hosted executor applies a stricter 4-minute implementation and 3-minute verification ceiling.</small>
          </label>
          <label className="field">Idle timeout (minutes)
            <input type="number" min="1" max="1440" value={config.idleTimeoutMinutes} disabled={!isAdmin} onChange={(event) => change("idleTimeoutMinutes", Number(event.target.value))} />
          </label>
          <label className="field">Tenki image
            <input value={config.tenkiImage ?? ""} disabled={!isAdmin} placeholder="Use Tenki default" onChange={(event) => change("tenkiImage", event.target.value || null)} />
          </label>
          <label className="field">Tenki snapshot ID
            <input value={config.tenkiSnapshotId ?? ""} disabled={!isAdmin} placeholder="Optional" onChange={(event) => change("tenkiSnapshotId", event.target.value || null)} />
          </label>
        </div>
        <div className="execution-profile-network">
          <label className="toggle-row">
            <div><strong>Outbound network</strong><p className="subtle">Keep disabled unless this exact profile needs external access.</p></div>
            <input type="checkbox" checked={config.allowOutbound} disabled={!isAdmin} onChange={(event) => change("allowOutbound", event.target.checked)} />
          </label>
          <label className="toggle-row">
            <div><strong>Inbound network</strong><p className="subtle">Disabled by default for isolated agent runs.</p></div>
            <input type="checkbox" checked={config.allowInbound} disabled={!isAdmin} onChange={(event) => change("allowInbound", event.target.checked)} />
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

export function ExecutionProfileSettings({
  orgId,
  isAdmin,
}: {
  orgId: string;
  isAdmin: boolean;
}) {
  const [view, setView] = useState<ExecutionProfileApiView>();
  const [loading, setLoading] = useState(true);
  const [busyRepository, setBusyRepository] = useState<string>();
  const [busyProfile, setBusyProfile] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
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
        if (!cancelled) setView(payload);
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
  }, [orgId]);

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

  async function detect(repository: string): Promise<void> {
    if (!isAdmin) return;
    setBusyRepository(repository);
    setError(undefined);
    try {
      const response = await fetch("/api/settings/execution-profiles/detect", {
        method: "POST",
        headers: requestHeaders(orgId, true),
        body: JSON.stringify({ repository }),
      });
      const payload = await response.json() as ApiResult;
      if (!response.ok || !payload.settings) throw new Error(payload.error ?? "Repository detection failed.");
      applySettings(payload.settings);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Repository detection failed.");
    } finally {
      setBusyRepository(undefined);
    }
  }

  async function confirm(profileId: string): Promise<void> {
    if (!isAdmin) return;
    setBusyProfile(profileId);
    setError(undefined);
    try {
      const response = await fetch("/api/settings/execution-profiles/confirm", {
        method: "POST",
        headers: requestHeaders(orgId, true),
        body: JSON.stringify({ detectedProfileId: profileId }),
      });
      const payload = await response.json() as ApiResult;
      if (!response.ok || !payload.settings) throw new Error(payload.error ?? "Execution profile could not be confirmed.");
      applySettings(payload.settings);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Execution profile could not be confirmed.");
    } finally {
      setBusyProfile(undefined);
    }
  }

  if (loading) {
    return <p className="chatgpt-text-loading" role="status">Loading execution profiles<span aria-hidden="true">…</span></p>;
  }
  if (error && !view) return <div className="toast error" role="alert">{error}</div>;
  if (!view?.available) {
    return <div className="callout"><div className="callout-title">Persistent workspace required</div><p className="subtle">Execution profiles are available for production workspaces backed by PostgreSQL.</p></div>;
  }

  const workspaceAssignment = assignmentForWorkspace(view.assignments);
  const workspaceProfile = workspaceAssignment?.activeProfile ?? view.safeGenericProfile;
  return (
    <div className="execution-profile-settings">
      {error && <div className="toast error" role="alert">{error}</div>}
      <div className="callout">
        <div className="callout-title">Profiles are immutable execution contracts</div>
        <p className="subtle">Detected metadata remains inactive until an admin confirms it. The selected profile ID, version, hash, and full snapshot are then bound to PDD, approval, implementation, and independent verification.</p>
      </div>

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
          onSaved={applySettings}
        />
      </article>

      <div className="execution-profile-repositories">
        {view.repositories.filter((repository) => repository.active).map((repository) => {
          const assignments = assignmentsByRepository.get(repository.repository) ?? [];
          return (
            <article className="execution-profile-scope" key={repository.id}>
              <div className="execution-profile-scope-head">
                <div><span className="eyebrow">Authorized repository</span><h3>{repository.repository}</h3><p className="subtle">Default branch <code>{repository.defaultBranch}</code> · metadata-only detection at an exact commit SHA</p></div>
                <button type="button" className="btn secondary" disabled={!isAdmin || Boolean(busyRepository)} onClick={() => detect(repository.repository)}>
                  {busyRepository === repository.repository ? "Detecting…" : assignments.length ? "Refresh detection" : "Detect configuration"}
                </button>
              </div>
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
                    onSaved={applySettings}
                  />
                </div>
              ) : assignments.map((assignment) => {
                const shown = assignment.activeProfile ?? assignment.detectedProfile;
                if (!shown) return null;
                return (
                  <div className="execution-profile-root" key={`${assignment.repository}:${assignment.workspaceRoot}`}>
                    <div className="split">
                      <div><strong>Root <code>{assignment.workspaceRoot}</code></strong><p className="subtle">{assignment.activeProfile ? profileLabel(assignment.activeProfile) : "Pending admin review"}</p></div>
                      <div className="top-actions">
                        {assignment.activeProfile && <span className="badge success">Active</span>}
                        {assignment.detectedProfile && (
                          <button type="button" className="btn secondary" disabled={!isAdmin || Boolean(busyProfile)} onClick={() => confirm(assignment.detectedProfile!.id)}>
                            {busyProfile === assignment.detectedProfile.id ? "Confirming…" : assignment.activeProfile ? "Confirm new detection" : "Confirm & activate"}
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
                      onSaved={applySettings}
                    />
                  </div>
                );
              })}
            </article>
          );
        })}
        {view.repositories.filter((repository) => repository.active).length === 0 && (
          <div className="empty-state execution-profile-no-repositories">
            <strong>Connect a GitHub repository first</strong>
            <p className="subtle">Install the CloseSpan GitHub App and explicitly authorize repositories before creating execution profiles.</p>
          </div>
        )}
      </div>
    </div>
  );
}
