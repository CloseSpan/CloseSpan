import { databasePool } from "./db";
import { workspacePersistenceMode } from "./workspace-persistence";

export type OnboardingPhase = "discover" | "connect" | "verify" | "complete";

export interface OnboardingMessage {
  role: "assistant" | "user";
  content: string;
  at: string;
}

export interface ProductProfile {
  productName: string | null;
  productUrl: string | null;
  productDescription: string | null;
  companyLogo?: string | null;
  companyProfileConfirmed?: boolean;
  companyProfileReadyForConfirmation?: boolean;
  feedbackSources: string[];
  engineeringTools: string[];
}

export interface RecommendedConnector {
  integrationId: string;
  provider: string;
  reason: string;
  priority: "required" | "recommended" | "optional";
  connectionMethod: "webhook" | "oauth" | "settings";
}

export interface OnboardingState {
  phase: OnboardingPhase;
  productProfile: ProductProfile;
  recommendedConnectors: RecommendedConnector[];
  messages: OnboardingMessage[];
}

const emptyProfile = (): ProductProfile => ({
  productName: null,
  productUrl: null,
  productDescription: null,
  companyLogo: null,
  companyProfileConfirmed: false,
  companyProfileReadyForConfirmation: false,
  feedbackSources: [],
  engineeringTools: [],
});

export function defaultOnboardingState(): OnboardingState {
  return {
    phase: "discover",
    productProfile: emptyProfile(),
    recommendedConnectors: [],
    messages: [],
  };
}

export function demoOnboardingState(): OnboardingState {
  return {
    phase: "complete",
    productProfile: {
      productName: "Northstar Analytics",
      productUrl: "https://northstar.example",
      productDescription:
        "A B2B analytics platform used by operations teams to monitor customer and business performance.",
      companyLogo: null,
      companyProfileConfirmed: true,
      companyProfileReadyForConfirmation: true,
      feedbackSources: ["Zendesk", "Intercom", "Slack"],
      engineeringTools: ["GitHub"],
    },
    recommendedConnectors: [
      {
        integrationId: "int_zendesk",
        provider: "Zendesk",
        reason: "Primary source for customer support tickets.",
        priority: "required",
        connectionMethod: "oauth",
      },
      {
        integrationId: "int_intercom",
        provider: "Intercom",
        reason: "Adds in-product customer conversations.",
        priority: "recommended",
        connectionMethod: "oauth",
      },
      {
        integrationId: "int_slack",
        provider: "Slack",
        reason: "Captures customer-success escalations and qualitative feedback.",
        priority: "recommended",
        connectionMethod: "oauth",
      },
      {
        integrationId: "int_github",
        provider: "GitHub",
        reason: "Receives approved engineering actions after human review.",
        priority: "required",
        connectionMethod: "oauth",
      },
    ],
    messages: [],
  };
}

export async function getOnboardingState(orgId: string): Promise<OnboardingState> {
  if (workspacePersistenceMode(orgId) !== "postgres")
    return demoOnboardingState();
  const result = await databasePool().query<{
    phase: OnboardingPhase;
    product_profile: ProductProfile;
    recommended_connectors: RecommendedConnector[];
    messages: OnboardingMessage[];
  }>(
    `SELECT phase, product_profile, recommended_connectors, messages
       FROM workspace_onboarding
      WHERE org_id=$1`,
    [orgId],
  );
  const row = result.rows[0];
  if (!row) return defaultOnboardingState();
  return {
    phase: row.phase,
    productProfile: { ...emptyProfile(), ...row.product_profile },
    recommendedConnectors: row.recommended_connectors ?? [],
    messages: row.messages ?? [],
  };
}

export async function saveOnboardingState(
  orgId: string,
  state: OnboardingState,
): Promise<void> {
  if (workspacePersistenceMode(orgId) !== "postgres") return;
  await databasePool().query(
    `INSERT INTO workspace_onboarding(org_id, phase, product_profile, recommended_connectors, messages, updated_at)
     VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,now())
     ON CONFLICT (org_id) DO UPDATE SET
       phase=excluded.phase,
       product_profile=excluded.product_profile,
       recommended_connectors=excluded.recommended_connectors,
       messages=excluded.messages,
       updated_at=now()`,
    [
      orgId,
      state.phase,
      JSON.stringify(state.productProfile),
      JSON.stringify(state.recommendedConnectors),
      JSON.stringify(state.messages),
    ],
  );
}
