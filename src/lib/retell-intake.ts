import { analyzeAndClusterSlackSignals } from "./slack-intake";

/** Reuse classification and clustering, without starting coding runs or notifying customers. */
export async function analyzeRetellFeedback(orgId: string): Promise<void> {
  try {
    await analyzeAndClusterSlackSignals(orgId, "retell");
  } catch {
    // Persisted feedback remains available for a later import retry or manual inbox analysis.
    console.warn("Retell feedback saved; automatic analysis did not complete.");
  }
}
