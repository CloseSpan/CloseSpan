import { persistenceMode } from "./db";
export type WorkspacePersistenceMode = "memory" | "postgres";

export function memoryDemoOrganizationId(): string | null {
  return process.env.DEMO_MEMORY_ORG_ID?.trim() || null;
}

export function isMemoryDemoOrganization(orgId: string): boolean {
  const demoOrganizationId = memoryDemoOrganizationId();
  return Boolean(demoOrganizationId) && orgId === demoOrganizationId;
}

/**
 * Routes one workspace to its persistence boundary. The presentation workspace
 * is the only in-memory tenant; every other workspace follows the configured
 * durable persistence mode.
 */
export function workspacePersistenceMode(
  orgId: string,
): WorkspacePersistenceMode {
  const baseMode = persistenceMode();
  if (baseMode === "memory") return "memory";
  return isMemoryDemoOrganization(orgId) ? "memory" : baseMode;
}

export function requirePostgresWorkspace(
  orgId: string,
  capability: string,
): void {
  if (workspacePersistenceMode(orgId) !== "postgres") {
    throw new Error(`${capability} is unavailable in the seeded demo workspace`);
  }
}
