import { approval, primaryProblem } from "./seed";
import type { ApprovalRequest, AuditEvent, Stage } from "./domain";

export interface DemoState {
  orgId: string;
  version: number;
  approval: ApprovalRequest;
  problemStage: Stage;
  workItem?: { id: string; url: string; simulated: true };
  notifications: "Not drafted" | "Drafted" | "Approved";
  audit: AuditEvent[];
  processedActions: Record<string, string>;
}

interface ActionContext { actorId: string; actorName: string; idempotencyKey: string; traceId: string }

const globalStore = globalThis as typeof globalThis & { closespanStates?: Map<string, DemoState> };

function now(): string { return new Date().toISOString(); }
function event(orgId: string, actorId: string, actorName: string, action: string, entityType: AuditEvent["entityType"], entityId: string, traceId: string): AuditEvent {
  return { id: crypto.randomUUID(), orgId, occurredAt: now(), actorId, actorName, action, entityType, entityId, traceId };
}

function initialState(orgId: string): DemoState {
  return {
    orgId, version: 1, approval: structuredClone(approval), problemStage: primaryProblem.stage, notifications: "Not drafted", processedActions: {},
    audit: [
      event(orgId, "agent_classification", "Classification agent", "Classified fb_001 as a high-severity bug (96% confidence)", "ProductProblem", primaryProblem.id, "seed-classification"),
      event(orgId, "agent_clustering", "Clustering agent", "Associated fb_001 with this problem; evidence similarity 0.91", "ProductProblem", primaryProblem.id, "seed-clustering"),
      event(orgId, "agent_investigation", "Investigation agent", "Prepared a code-aware recommendation for human review", "ApprovalRequest", approval.id, "seed-investigation"),
    ],
  };
}

function states(): Map<string, DemoState> {
  globalStore.closespanStates ??= new Map();
  return globalStore.closespanStates;
}

export function getMemoryState(orgId: string): DemoState {
  const current = states().get(orgId) ?? initialState(orgId);
  states().set(orgId, current);
  return current;
}

export function findMemoryState(orgId: string): DemoState | null {
  const current = states().get(orgId);
  if (current) return current;
  return orgId === approval.orgId ? getMemoryState(orgId) : null;
}

function alreadyProcessed(state: DemoState, context: ActionContext, action: string): boolean {
  const processed = state.processedActions[context.idempotencyKey];
  if (processed && processed !== action) throw new Error("Idempotency key was already used for a different action");
  return processed === action;
}

export function approveMemoryAction(orgId: string, context: ActionContext): DemoState {
  const state = getMemoryState(orgId);
  if (alreadyProcessed(state, context, "approve")) return state;
  if (state.approval.status !== "Pending") throw new Error("Approval is no longer pending");
  state.approval.status = "Approved";
  state.problemStage = "Approved";
  state.workItem = { id: "GH-1842", url: "#simulated-work-item", simulated: true };
  state.version += 1;
  state.processedActions[context.idempotencyKey] = "approve";
  state.audit.unshift(event(orgId, context.actorId, context.actorName, "Approved simulated GitHub issue GH-1842", "ApprovalRequest", state.approval.id, context.traceId));
  return state;
}

export function rejectMemoryAction(orgId: string, context: ActionContext): DemoState {
  const state = getMemoryState(orgId);
  if (alreadyProcessed(state, context, "reject")) return state;
  if (state.approval.status !== "Pending") throw new Error("Approval is no longer pending");
  state.approval.status = "Rejected";
  state.version += 1;
  state.processedActions[context.idempotencyKey] = "reject";
  state.audit.unshift(event(orgId, context.actorId, context.actorName, "Rejected simulated GitHub issue proposal", "ApprovalRequest", state.approval.id, context.traceId));
  return state;
}

export function advanceMemoryLifecycle(orgId: string, context: ActionContext): DemoState {
  const state = getMemoryState(orgId);
  if (alreadyProcessed(state, context, "advance")) return state;
  const next: Partial<Record<Stage, Stage>> = { Approved: "Planned", Planned: "In progress", "In progress": "Released", Released: "Verified", Verified: "Closed" };
  const target = next[state.problemStage];
  if (!target) throw new Error("The problem cannot advance from its current stage");
  state.problemStage = target;
  state.version += 1;
  state.processedActions[context.idempotencyKey] = "advance";
  if (target === "Verified") state.notifications = "Drafted";
  state.audit.unshift(event(orgId, context.actorId, context.actorName, `Moved problem to ${target}`, "ProductProblem", primaryProblem.id, context.traceId));
  return state;
}

export function approveMemoryNotifications(orgId: string, context: ActionContext): DemoState {
  const state = getMemoryState(orgId);
  if (alreadyProcessed(state, context, "notify")) return state;
  if (!["Verified", "Closed"].includes(state.problemStage) || state.notifications !== "Drafted") throw new Error("Customer follow-up requires a verified resolution and drafted messages");
  state.notifications = "Approved";
  state.version += 1;
  state.processedActions[context.idempotencyKey] = "notify";
  state.audit.unshift(event(orgId, context.actorId, context.actorName, "Approved three simulated customer follow-up drafts", "CustomerNotification", primaryProblem.id, context.traceId));
  return state;
}

export function resetMemoryState(orgId?: string): void {
  if (orgId) {
    states().delete(orgId);
    return;
  }
  globalStore.closespanStates = new Map();
}
