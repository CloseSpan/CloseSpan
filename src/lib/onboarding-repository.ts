import { databasePool, persistenceMode } from "./db";

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

export async function getOnboardingState(orgId: string): Promise<OnboardingState> {
  if (persistenceMode() !== "postgres") return defaultOnboardingState();
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
  if (persistenceMode() !== "postgres") return;
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
