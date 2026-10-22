import { workspacePersistenceMode } from "./workspace-persistence";
import { advanceMemoryLifecycle, approveMemoryAction, approveMemoryNotifications, findMemoryState, getMemoryState, rejectMemoryAction, resetMemoryState, type DemoState } from "./memory-store";
import { advancePostgresLifecycle, approvePostgresAction, approvePostgresNotifications, findPostgresState, getPostgresState, rejectPostgresAction } from "./postgres-store";

export type { DemoState } from "./memory-store";
interface ActionContext { actorId: string; actorName: string; idempotencyKey: string; traceId: string }

function memoryState(orgId: string, problemId: string | null): DemoState {
  if (!problemId) return getMemoryState(orgId);
  const state = findMemoryState(orgId, problemId);
  if (!state) throw new Error("No approval workflow exists for this issue");
  return state;
}
export async function getState(orgId: string, problemId: string | null = null): Promise<DemoState> { return workspacePersistenceMode(orgId) === "postgres" ? getPostgresState(orgId, problemId) : memoryState(orgId, problemId); }
/** Legacy approval workflow; pass a problem id to read that issue's workflow instead of the primary one. */
export async function findState(orgId: string, problemId: string | null = null): Promise<DemoState | null> { return workspacePersistenceMode(orgId) === "postgres" ? findPostgresState(orgId, problemId) : findMemoryState(orgId, problemId); }
export async function approveAction(orgId: string, context: ActionContext, problemId: string | null = null): Promise<DemoState> { return workspacePersistenceMode(orgId) === "postgres" ? approvePostgresAction(orgId, context, problemId) : approveMemoryAction(orgId, context, problemId); }
export async function rejectAction(orgId: string, context: ActionContext, problemId: string | null = null): Promise<DemoState> { return workspacePersistenceMode(orgId) === "postgres" ? rejectPostgresAction(orgId, context, problemId) : rejectMemoryAction(orgId, context, problemId); }
export async function advanceLifecycle(orgId: string, context: ActionContext, problemId: string | null = null): Promise<DemoState> { return workspacePersistenceMode(orgId) === "postgres" ? advancePostgresLifecycle(orgId, context, problemId) : advanceMemoryLifecycle(orgId, context, problemId); }
export async function approveNotifications(orgId: string, context: ActionContext, problemId: string | null = null): Promise<DemoState> { return workspacePersistenceMode(orgId) === "postgres" ? approvePostgresNotifications(orgId, context, problemId) : approveMemoryNotifications(orgId, context, problemId); }
export function resetDemoState(): void { resetMemoryState(); }
