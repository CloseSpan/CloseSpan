import { databasePool } from "./db";
import { workspacePersistenceMode } from "./workspace-persistence";

/** Presentation is an explicit tenant marker, never inferred from a workspace name. */
export async function readPresentationDemo(orgId: string): Promise<boolean> {
  if (workspacePersistenceMode(orgId) !== "postgres") return false;
  const result = await databasePool().query<{ demo_mode: string | null }>(
    "SELECT product_profile->>'demoMode' AS demo_mode FROM workspace_onboarding WHERE org_id=$1",
    [orgId],
  );
  return result.rows[0]?.demo_mode === "presentation";
}
