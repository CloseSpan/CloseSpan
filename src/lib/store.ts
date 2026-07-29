import { workspacePersistenceMode } from "./workspace-persistence";
import { advanceMemoryLifecycle, approveMemoryAction, approveMemoryNotifications, findMemoryState, getMemoryState, rejectMemoryAction, resetMemoryState, type DemoState } from "./memory-store";
import { advancePostgresLifecycle, approvePostgresAction, approvePostgresNotifications, findPostgresState, getPostgresState, rejectPostgresAction } from "./postgres-store";

export type { DemoState } from "./memory-store";
interface ActionContext { actorId: string; actorName: string; idempotencyKey: string; traceId: string }

export async function getState(orgId: string): Promise<DemoState> { return workspacePersistenceMode(orgId) === "postgres" ? getPostgresState(orgId) : getMemoryState(orgId); }
export async function findState(orgId: string): Promise<DemoState | null> { return workspacePersistenceMode(orgId) === "postgres" ? findPostgresState(orgId) : findMemoryState(orgId); }
export async function approveAction(orgId: string, context: ActionContext): Promise<DemoState> { return workspacePersistenceMode(orgId) === "postgres" ? approvePostgresAction(orgId, context) : approveMemoryAction(orgId, context); }
export async function rejectAction(orgId: string, context: ActionContext): Promise<DemoState> { return workspacePersistenceMode(orgId) === "postgres" ? rejectPostgresAction(orgId, context) : rejectMemoryAction(orgId, context); }
export async function advanceLifecycle(orgId: string, context: ActionContext): Promise<DemoState> { return workspacePersistenceMode(orgId) === "postgres" ? advancePostgresLifecycle(orgId, context) : advanceMemoryLifecycle(orgId, context); }
export async function approveNotifications(orgId: string, context: ActionContext): Promise<DemoState> { return workspacePersistenceMode(orgId) === "postgres" ? approvePostgresNotifications(orgId, context) : approveMemoryNotifications(orgId, context); }
export function resetDemoState(): void { resetMemoryState(); }
