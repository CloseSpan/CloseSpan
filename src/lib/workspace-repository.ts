import { databasePool, persistenceMode } from "./db";
import type { FeedbackItem, ImpactFactor, ProductProblem, Recommendation } from "./domain";
import { feedback as seedFeedback, primaryProblem as seedProblem, recommendation as seedRecommendation } from "./seed";
import { getOverviewAnalytics } from "./overview-repository";
import { overviewAnalytics, type OverviewAnalytics } from "./overview-analytics";
import { getAiPublicConfiguration, type AiPublicConfiguration } from "./ai-config";
import { integrationCatalog } from "./integration-catalog";
import { getIntegrationExperience } from "./integration-ui";

export interface IntegrationView { id: string; name: string; category: string; state: string; lastSync: string | null; dataScope: string; permissions: string[] }
export interface InvestigationQueueItem { id: string; problemId: string; title: string; status: string }
export interface CustomerView { id: string; name: string; tier: string; arr: number; customerSince: number; signals: number; openProblems: number; churnRisk: string }
export interface SettingsView {
  autonomyLevel: string; piiRedaction: boolean; retentionDays: number; priorityWeights: Record<string,number>;
  monthlyModelBudget: number; usedModelCost: number; hardStop: boolean; planName: string; planPrice: string;
  ai: AiPublicConfiguration & { promptVersion:string; lastRunStatus:string | null; lastRunAt:string | null };
  members: Array<{ id: string; name: string; email: string; role: string; team: string }>;
}
export interface WorkspaceData {
  orgId: string; feedback: FeedbackItem[]; primaryProblem: ProductProblem | null; recommendation: Recommendation | null;
  analytics: OverviewAnalytics; integrations: IntegrationView[]; investigationQueue: InvestigationQueueItem[];
  customers: CustomerView[]; settings: SettingsView;
}

const defaultPriorityWeights = {
  frequency: 20,
  severity: 20,
  revenue: 20,
  churnRisk: 15,
  customerTier: 10,
  strategicAlignment: 5,
  sla: 5,
  engineeringEffort: 5,
};

export function createDefaultWorkspaceSettings(
  ai: SettingsView["ai"],
  members: SettingsView["members"] = [],
): SettingsView {
  return {
    autonomyLevel: "Observe",
    piiRedaction: true,
    retentionDays: 365,
    priorityWeights: { ...defaultPriorityWeights },
    monthlyModelBudget: 0,
    usedModelCost: 0,
    hardStop: true,
    planName: "Production",
    planPrice: "Managed externally",
    ai,
    members,
  };
}

const memoryIntegrations = integrationCatalog.map((entry) => {
  const experience = getIntegrationExperience(entry);
  const isZendesk = entry.id === "int_zendesk";
  const isGitHub = entry.id === "int_github";
  return {
    id: entry.id,
    name: entry.provider,
    category: entry.category,
    state: isZendesk
      ? "Seeded sample"
      : isGitHub
        ? "Demo configured"
        : "Not connected",
    lastSync: isZendesk ? "2026-07-23T16:42:00.000Z" : null,
    dataScope: isZendesk
      ? "Tickets, comments, tags, and customer references"
      : isGitHub
        ? "Repository metadata and approved issue creation"
        : "None",
    permissions:
      isZendesk || isGitHub ? [...experience.requestedPermissions] : [],
  };
});

async function memoryData(orgId: string): Promise<WorkspaceData> {
  const analytics = overviewAnalytics;
  const ai = await getAiPublicConfiguration(orgId);
  return { orgId, feedback: seedFeedback, primaryProblem: seedProblem, recommendation: seedRecommendation, analytics, integrations: memoryIntegrations,
    investigationQueue: [{id:"inv_sso",problemId:"prob_sso",title:"SAML role mapping",status:"Running"},{id:"inv_filters",problemId:"prob_filters",title:"Saved filter regression",status:"Queued"},{id:"inv_invites",problemId:"prob_invites",title:"Invite confirmation",status:"Needs context"}],
    customers: [...new Map(seedFeedback.map((item,index) => [item.customer,{id:item.id,name:item.customer,tier:item.accountTier,arr:item.arr,customerSince:2021+index,signals:1,openProblems:item.problemId?1:0,churnRisk:index<2?"Elevated":"Low"}])).values()],
    settings: { autonomyLevel:"Execute with approval",piiRedaction:true,retentionDays:365,priorityWeights:Object.fromEntries(seedProblem.impactFactors.map((factor) => [factor.key,factor.weight])),monthlyModelBudget:500,usedModelCost:128,hardStop:true,planName:"Sandbox",planPrice:"$0",ai:{...ai,promptVersion:"v1",lastRunStatus:null,lastRunAt:null},members:[{id:"user_avery",name:"Avery Chen",email:"avery@example.com",role:"Admin",team:"Product"}] } };
}

interface PrimaryProblemRow {
  id: string;
  org_id: string;
  title: string;
  statement: string;
  summary: string;
  stage: ProductProblem["stage"];
  severity: ProductProblem["severity"];
  confidence: number;
  product_area: string;
  team: string;
  feedback_ids: string[] | null;
  impact_factors: ImpactFactor[];
  churn_risk: number;
  suspected_repository: string;
  suspected_files: string[];
  investigation_id: string | null;
  hypothesis: string | null;
  investigation_confidence: number | null;
  assumptions: string[] | null;
  missing_information: string[] | null;
  proposed_action: string | null;
  recommended_tests: string[] | null;
  investigation_files: string[] | null;
}

export function mapPrimaryWorkspaceDomain(
  row?: PrimaryProblemRow,
): {
  primaryProblem: ProductProblem | null;
  recommendation: Recommendation | null;
} {
  if (!row) return { primaryProblem: null, recommendation: null };
  const primaryProblem: ProductProblem = {
    id: row.id,
    orgId: row.org_id,
    title: row.title,
    statement: row.statement,
    summary: row.summary,
    stage: row.stage,
    severity: row.severity,
    confidence: row.confidence,
    productArea: row.product_area,
    team: row.team,
    feedbackIds: row.feedback_ids ?? [],
    impactFactors: row.impact_factors ?? [],
    churnRisk: row.churn_risk,
    suspectedRepository: row.suspected_repository,
    suspectedFiles: row.investigation_files ?? row.suspected_files ?? [],
  };
  const recommendation =
    row.investigation_id &&
    row.hypothesis !== null &&
    row.investigation_confidence !== null &&
    row.proposed_action !== null
      ? {
          id: row.investigation_id,
          orgId: row.org_id,
          problemId: row.id,
          hypothesis: row.hypothesis,
          confidence: row.investigation_confidence,
          assumptions: row.assumptions ?? [],
          missingInformation: row.missing_information ?? [],
          proposedAction: row.proposed_action,
          tests: row.recommended_tests ?? [],
        }
      : null;
  return { primaryProblem, recommendation };
}

export async function getWorkspaceData(orgId: string): Promise<WorkspaceData> {
  if (persistenceMode() === "memory") return await memoryData(orgId);
  const pool = databasePool();
  const [analytics, feedbackResult, problemResult, investigationResult, integrationResult, customerResult, settingsResult, membersResult, promptResult, modelRunResult, ai] = await Promise.all([
    getOverviewAnalytics(orgId),
    pool.query<{
      id:string; org_id:string; source:FeedbackItem["source"]; customer_name:string;
      account_tier:FeedbackItem["accountTier"]; arr:number; type:FeedbackItem["type"];
      severity:FeedbackItem["severity"]; redacted:boolean; environment:string;
      confidence:number; observed_at:string; quote:string; problem_id:string | null;
    }>(`SELECT f.id,f.org_id,f.source,f.customer_name,f.account_tier,f.arr,f.type,f.severity,f.redacted,f.environment,f.confidence,f.observed_at,f.quote,m.problem_id
      FROM feedback_items f
      LEFT JOIN LATERAL (
        SELECT membership.problem_id
        FROM feedback_cluster_memberships membership
        WHERE membership.org_id=f.org_id AND membership.feedback_id=f.id
        ORDER BY membership.created_at DESC,membership.problem_id
        LIMIT 1
      ) m ON true
      WHERE f.org_id=$1 ORDER BY f.created_at,f.id`,[orgId]),
    pool.query<PrimaryProblemRow>(`SELECT p.*,
      memberships.feedback_ids,
      i.id investigation_id,i.hypothesis,i.confidence investigation_confidence,
      i.assumptions,i.missing_information,i.proposed_action,
      i.recommended_tests,i.suspected_files investigation_files
      FROM product_problems p
      LEFT JOIN workspaces w ON w.org_id=p.org_id
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(m.feedback_id ORDER BY m.created_at,m.feedback_id) AS feedback_ids
        FROM feedback_cluster_memberships m
        WHERE m.org_id=p.org_id AND m.problem_id=p.id
      ) memberships ON true
      LEFT JOIN LATERAL (
        SELECT candidate.*
        FROM investigations candidate
        WHERE candidate.org_id=p.org_id AND candidate.problem_id=p.id
        ORDER BY (candidate.status='Ready for approval') DESC,
                 candidate.updated_at DESC,candidate.id
        LIMIT 1
      ) i ON true
      WHERE p.org_id=$1
      ORDER BY (w.primary_problem_id=p.id) DESC,
        (p.stage <> 'Closed') DESC,
        CASE p.severity WHEN 'Critical' THEN 4 WHEN 'High' THEN 3 WHEN 'Medium' THEN 2 ELSE 1 END DESC,
        p.confidence DESC,p.updated_at DESC,p.id
      LIMIT 1`,[orgId]),
    pool.query<{ id:string; problem_id:string; title:string; status:string }>("SELECT id,problem_id,title,status FROM investigations WHERE org_id=$1 ORDER BY created_at,id",[orgId]),
    pool.query<{ id:string; provider:string; category:string; connection_state:string; last_sync_at:Date | null; data_scope:string; permissions:string[] }>("SELECT id,provider,category,connection_state,last_sync_at,data_scope,permissions FROM integrations WHERE org_id=$1 ORDER BY display_order,id",[orgId]),
    pool.query<{ id:string; name:string; tier:string; arr:number; customer_since:number; churn_risk:string; signals:number; open_problems:number }>(`SELECT a.id,a.name,a.tier,a.arr,a.customer_since,a.churn_risk,count(DISTINCT f.id)::int signals,count(DISTINCT i.problem_id)::int open_problems
      FROM accounts a LEFT JOIN feedback_items f ON f.org_id=a.org_id AND f.customer_name=a.name LEFT JOIN problem_account_impacts i ON i.org_id=a.org_id AND i.account_id=a.id
      WHERE a.org_id=$1 GROUP BY a.id,a.org_id ORDER BY a.arr DESC`,[orgId]),
    pool.query<{ autonomy_level:string; pii_redaction:boolean; retention_days:number; priority_weights:Record<string,number>; monthly_model_budget:number; used_model_cost:number; hard_stop:boolean; plan_name:string; plan_price:string }>("SELECT * FROM workspace_settings WHERE org_id=$1",[orgId]),
    pool.query<{ id:string; display_name:string; email:string; role:string; team:string }>("SELECT id,display_name,email,role,team FROM workspace_members WHERE org_id=$1 ORDER BY display_name",[orgId]),
    pool.query<{ version:number }>("SELECT version FROM prompt_versions WHERE org_id=$1 AND name='feedback-intelligence' AND active=true",[orgId]),
    pool.query<{ status:string; started_at:Date }>("SELECT status,started_at FROM model_runs WHERE org_id=$1 ORDER BY started_at DESC LIMIT 1",[orgId]),
    getAiPublicConfiguration(orgId),
  ]);
  const { primaryProblem, recommendation } = mapPrimaryWorkspaceDomain(
    problemResult.rows[0],
  );
  const settingsRow = settingsResult.rows[0];
  const members = membersResult.rows.map((item) => ({
    id:item.id,name:item.display_name,email:item.email,role:item.role,team:item.team,
  }));
  const aiSettings = {
    ...ai,
    promptVersion:promptResult.rows[0] ? `v${promptResult.rows[0].version}` : "Not installed",
    lastRunStatus:modelRunResult.rows[0]?.status ?? null,
    lastRunAt:modelRunResult.rows[0]?.started_at?.toISOString?.() ?? null,
  };
  const settings = settingsRow
    ? {
        autonomyLevel:settingsRow.autonomy_level,
        piiRedaction:settingsRow.pii_redaction,
        retentionDays:settingsRow.retention_days,
        priorityWeights:settingsRow.priority_weights,
        monthlyModelBudget:settingsRow.monthly_model_budget,
        usedModelCost:settingsRow.used_model_cost,
        hardStop:settingsRow.hard_stop,
        planName:settingsRow.plan_name,
        planPrice:settingsRow.plan_price,
        ai:aiSettings,
        members,
      }
    : createDefaultWorkspaceSettings(aiSettings,members);
  const feedback: FeedbackItem[] = feedbackResult.rows.map((item) => ({ id:item.id,orgId:item.org_id,source:item.source,customer:item.customer_name,accountTier:item.account_tier,arr:item.arr,type:item.type,severity:item.severity,redacted:item.redacted,environment:item.environment,problemId:item.problem_id ?? undefined,confidence:item.confidence,observedAt:item.observed_at,quote:item.quote }));
  return { orgId,feedback,primaryProblem,recommendation,analytics,
    integrations:integrationResult.rows.map((item) => ({id:item.id,name:item.provider,category:item.category,state:item.connection_state,lastSync:item.last_sync_at?.toISOString?.() ?? null,dataScope:item.data_scope,permissions:item.permissions})),
    investigationQueue:investigationResult.rows.filter((item) => item.id !== recommendation?.id).map((item) => ({id:item.id,problemId:item.problem_id,title:item.title,status:item.status})),
    customers:customerResult.rows.map((item) => ({id:item.id,name:item.name,tier:item.tier,arr:item.arr,customerSince:item.customer_since,signals:item.signals,openProblems:item.open_problems,churnRisk:item.churn_risk})),
    settings };
}
