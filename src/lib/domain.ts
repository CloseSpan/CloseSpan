export type Source = "Intercom" | "Zendesk" | "Slack" | "Email" | "Survey";
export type FeedbackType = "Bug" | "Feature request" | "Usability" | "Question" | "Incident";
export type Severity = "Critical" | "High" | "Medium" | "Low";
export type Stage = "Detected" | "Needs review" | "Approved" | "Planned" | "In progress" | "Released" | "Verified" | "Closed";

export interface EvidenceRef {
  id: string;
  quote: string;
  source: Source;
  customer: string;
  observedAt: string;
}

export interface FeedbackItem extends EvidenceRef {
  orgId: string;
  accountTier: "Enterprise" | "Growth" | "Starter";
  arr: number;
  type: FeedbackType;
  severity: Severity;
  redacted: boolean;
  environment: string;
  problemId?: string;
  confidence: number;
}

export interface ImpactFactor {
  key: "frequency" | "severity" | "revenue" | "churnRisk" | "customerTier" | "strategicAlignment" | "sla" | "engineeringEffort";
  label: string;
  value: number;
  weight: number;
  evidence: string;
}

export interface ProductProblem {
  id: string;
  orgId: string;
  title: string;
  summary: string;
  statement: string;
  stage: Stage;
  severity: Severity;
  confidence: number;
  productArea: string;
  team: string;
  feedbackIds: string[];
  impactFactors: ImpactFactor[];
  churnRisk: number;
  suspectedRepository: string;
  suspectedFiles: string[];
}

export interface Recommendation {
  id: string;
  orgId: string;
  problemId: string;
  hypothesis: string;
  confidence: number;
  assumptions: string[];
  missingInformation: string[];
  proposedAction: string;
  tests: string[];
}

export interface ApprovalRequest {
  id: string;
  orgId: string;
  problemId: string;
  recommendationId: string;
  action: string;
  reason: string;
  confidence: number;
  systems: string[];
  dataShared: string[];
  reversible: boolean;
  risk: "Low" | "Medium" | "High";
  status: "Pending" | "Approved" | "Rejected";
}

export interface AuditEvent {
  id: string;
  orgId: string;
  occurredAt: string;
  actorId: string;
  actorName: string;
  action: string;
  entityType: "ProductProblem" | "ApprovalRequest" | "CustomerNotification";
  entityId: string;
  traceId: string;
}

export function calculateImpact(factors: ImpactFactor[]): { score: number; explanation: string } {
  for (const factor of factors) {
    if (!Number.isFinite(factor.value) || factor.value < 0 || factor.value > 100) throw new Error(`${factor.label} value must be between 0 and 100`);
    if (!Number.isFinite(factor.weight) || factor.weight < 0 || factor.weight > 100) throw new Error(`${factor.label} weight must be between 0 and 100`);
  }
  if (new Set(factors.map((factor) => factor.key)).size !== factors.length) throw new Error("Impact factor keys must be unique");
  const active = factors.filter((factor) => factor.weight > 0);
  const totalWeight = active.reduce((sum, factor) => sum + factor.weight, 0);
  if (!totalWeight) return { score: 0, explanation: "No prioritization weights are enabled." };
  const contribution = (factor: ImpactFactor) => (factor.key === "engineeringEffort" ? 100 - factor.value : factor.value) * factor.weight;
  const score = Math.round(active.reduce((sum, factor) => sum + contribution(factor), 0) / totalWeight);
  const strongest = [...active].sort((a, b) => contribution(b) - contribution(a)).slice(0, 3);
  return {
    score,
    explanation: strongest.map((factor) => `${factor.label}: ${factor.evidence}`).join(" • "),
  };
}

export function assertTenant(recordOrgId: string, requestedOrgId: string): void {
  if (recordOrgId !== requestedOrgId) throw new Error("Tenant boundary violation");
}
