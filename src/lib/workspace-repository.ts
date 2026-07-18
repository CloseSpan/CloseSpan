import { databasePool, persistenceMode } from "./db";
import type { FeedbackItem, ImpactFactor, ProductProblem, Recommendation } from "./domain";
import { feedback as seedFeedback, primaryProblem as seedProblem, recommendation as seedRecommendation } from "./seed";
import { getOverviewAnalytics } from "./overview-repository";
import { overviewAnalytics, type OverviewAnalytics } from "./overview-analytics";
import { getAiPublicConfiguration, type AiPublicConfiguration } from "./ai-config";

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
  orgId: string; feedback: FeedbackItem[]; primaryProblem: ProductProblem; recommendation: Recommendation;
  analytics: OverviewAnalytics; integrations: IntegrationView[]; investigationQueue: InvestigationQueueItem[];
  customers: CustomerView[]; settings: SettingsView;
}

const memoryIntegrations = ["Zendesk","Intercom","Slack","Microsoft Teams","Gmail","Jira","Linear","GitHub","Salesforce","HubSpot","Sentry","Datadog","PostHog","App Store","Google Play"].map((name,index) => ({ id:`int_${index}`,name,category:index < 5 ? "Feedback" : index < 8 ? "Engineering" : "Platform",state:name === "GitHub" ? "Demo configured" : name === "Zendesk" ? "Seeded sample" : "Not connected",lastSync:null,dataScope:"None",permissions:[] }));

async function memoryData(orgId: string): Promise<WorkspaceData> {
  const analytics = overviewAnalytics;
  const ai = await getAiPublicConfiguration(orgId);
  return { orgId, feedback: seedFeedback, primaryProblem: seedProblem, recommendation: seedRecommendation, analytics, integrations: memoryIntegrations,
    investigationQueue: [{id:"inv_sso",problemId:"prob_sso",title:"SAML role mapping",status:"Running"},{id:"inv_filters",problemId:"prob_filters",title:"Saved filter regression",status:"Queued"},{id:"inv_invites",problemId:"prob_invites",title:"Invite confirmation",status:"Needs context"}],
    customers: [...new Map(seedFeedback.map((item,index) => [item.customer,{id:item.id,name:item.customer,tier:item.accountTier,arr:item.arr,customerSince:2021+index,signals:1,openProblems:item.problemId?1:0,churnRisk:index<2?"Elevated":"Low"}])).values()],
    settings: { autonomyLevel:"Execute with approval",piiRedaction:true,retentionDays:365,priorityWeights:Object.fromEntries(seedProblem.impactFactors.map((factor) => [factor.key,factor.weight])),monthlyModelBudget:500,usedModelCost:128,hardStop:true,planName:"Sandbox",planPrice:"$0",ai:{...ai,promptVersion:"v1",lastRunStatus:null,lastRunAt:null},members:[{id:"user_avery",name:"Avery Chen",email:"avery@example.com",role:"Admin",team:"Product"}] } };
}

export async function getWorkspaceData(orgId: string): Promise<WorkspaceData> {
  if (persistenceMode() === "memory") return await memoryData(orgId);
  const pool = databasePool();
  const [analytics, feedbackResult, problemResult, membershipResult, investigationResult, integrationResult, customerResult, settingsResult, membersResult, promptResult, modelRunResult] = await Promise.all([
    getOverviewAnalytics(orgId),
    pool.query(`SELECT f.id,f.org_id,f.source,f.customer_name,f.account_tier,f.arr,f.type,f.severity,f.redacted,f.environment,f.confidence,f.observed_at,f.quote,m.problem_id
      FROM feedback_items f LEFT JOIN feedback_cluster_memberships m ON m.org_id=f.org_id AND m.feedback_id=f.id WHERE f.org_id=$1 ORDER BY f.created_at`,[orgId]),
    pool.query(`SELECT p.*,i.id investigation_id,i.hypothesis,i.confidence investigation_confidence,i.assumptions,i.missing_information,i.proposed_action,i.recommended_tests,i.suspected_files investigation_files
      FROM product_problems p JOIN investigations i ON i.org_id=p.org_id AND i.problem_id=p.id WHERE p.org_id=$1 AND p.id='prob_export'`,[orgId]),
    pool.query<{ feedback_id:string }>("SELECT feedback_id FROM feedback_cluster_memberships WHERE org_id=$1 AND problem_id='prob_export' ORDER BY feedback_id",[orgId]),
    pool.query("SELECT id,problem_id,title,status FROM investigations WHERE org_id=$1 ORDER BY created_at",[orgId]),
    pool.query("SELECT id,provider,category,connection_state,last_sync_at,data_scope,permissions FROM integrations WHERE org_id=$1 ORDER BY display_order",[orgId]),
    pool.query(`SELECT a.id,a.name,a.tier,a.arr,a.customer_since,a.churn_risk,count(DISTINCT f.id)::int signals,count(DISTINCT i.problem_id)::int open_problems
      FROM accounts a LEFT JOIN feedback_items f ON f.org_id=a.org_id AND f.customer_name=a.name LEFT JOIN problem_account_impacts i ON i.org_id=a.org_id AND i.account_id=a.id
      WHERE a.org_id=$1 GROUP BY a.id,a.org_id ORDER BY a.arr DESC`,[orgId]),
    pool.query("SELECT * FROM workspace_settings WHERE org_id=$1",[orgId]),
    pool.query("SELECT id,display_name,email,role,team FROM workspace_members WHERE org_id=$1 ORDER BY display_name",[orgId]),
    pool.query<{ version:number }>("SELECT version FROM prompt_versions WHERE org_id=$1 AND name='feedback-intelligence' AND active=true",[orgId]),
    pool.query<{ status:string; started_at:Date }>("SELECT status,started_at FROM model_runs WHERE org_id=$1 ORDER BY started_at DESC LIMIT 1",[orgId]),
  ]);
  const row = problemResult.rows[0];
  const settings = settingsResult.rows[0];
  const ai = await getAiPublicConfiguration(orgId);
  if (!row || !settings) throw new Error(`Workspace domain data are not seeded for ${orgId}; run npm run db:seed`);
  const feedback: FeedbackItem[] = feedbackResult.rows.map((item) => ({ id:item.id,orgId:item.org_id,source:item.source,customer:item.customer_name,accountTier:item.account_tier,arr:item.arr,type:item.type,severity:item.severity,redacted:item.redacted,environment:item.environment,problemId:item.problem_id ?? undefined,confidence:item.confidence,observedAt:item.observed_at,quote:item.quote }));
  const primaryProblem: ProductProblem = { id:row.id,orgId:row.org_id,title:row.title,statement:row.statement,summary:row.summary,stage:row.stage,severity:row.severity,confidence:row.confidence,productArea:row.product_area,team:row.team,feedbackIds:membershipResult.rows.map((item) => item.feedback_id),impactFactors:row.impact_factors as ImpactFactor[],churnRisk:row.churn_risk,suspectedRepository:row.suspected_repository,suspectedFiles:row.investigation_files as string[] };
  const recommendation: Recommendation = { id:row.investigation_id,orgId:row.org_id,problemId:row.id,hypothesis:row.hypothesis,confidence:row.investigation_confidence,assumptions:row.assumptions,missingInformation:row.missing_information,proposedAction:row.proposed_action,tests:row.recommended_tests };
  return { orgId,feedback,primaryProblem,recommendation,analytics,
    integrations:integrationResult.rows.map((item) => ({id:item.id,name:item.provider,category:item.category,state:item.connection_state,lastSync:item.last_sync_at?.toISOString?.() ?? null,dataScope:item.data_scope,permissions:item.permissions})),
    investigationQueue:investigationResult.rows.filter((item) => item.problem_id !== primaryProblem.id).map((item) => ({id:item.id,problemId:item.problem_id,title:item.title,status:item.status})),
    customers:customerResult.rows.map((item) => ({id:item.id,name:item.name,tier:item.tier,arr:item.arr,customerSince:item.customer_since,signals:item.signals,openProblems:item.open_problems,churnRisk:item.churn_risk})),
    settings:{autonomyLevel:settings.autonomy_level,piiRedaction:settings.pii_redaction,retentionDays:settings.retention_days,priorityWeights:settings.priority_weights,monthlyModelBudget:settings.monthly_model_budget,usedModelCost:settings.used_model_cost,hardStop:settings.hard_stop,planName:settings.plan_name,planPrice:settings.plan_price,ai:{...ai,promptVersion:`v${promptResult.rows[0]?.version ?? "—"}`,lastRunStatus:modelRunResult.rows[0]?.status ?? null,lastRunAt:modelRunResult.rows[0]?.started_at?.toISOString?.() ?? null},members:membersResult.rows.map((item) => ({id:item.id,name:item.display_name,email:item.email,role:item.role,team:item.team}))} };
}
