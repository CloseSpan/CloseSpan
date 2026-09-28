import { analyzeAndClusterSlackSignals } from "./slack-intake";

/** Reuse classification and clustering, without starting coding runs or notifying customers. */
export async function analyzeRetellFeedback(orgId: string): Promise<{ analyzed: number; clustered: number }> {
  try {
    return await analyzeAndClusterSlackSignals(orgId, "retell");
  } catch {
    // Persisted feedback remains available for a later import retry or manual inbox analysis.
    console.warn("Retell feedback saved; automatic analysis did not complete.");
    return { analyzed: 0, clustered: 0 };
  }
}
