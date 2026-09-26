// Run: npx tsx --env-file=.env scripts/backfill-problem-subjects.ts --org <id> [--apply]
// Preview is the default. It makes one bounded AI request but performs no writes.
import { backfillProblemSubjects } from "../src/lib/problem-subject-backfill";
import { databasePool } from "../src/lib/db";

const args = process.argv.slice(2);
const orgIndex = args.indexOf("--org");
const orgId = orgIndex < 0 ? "" : args[orgIndex + 1];
if (!orgId || orgId.startsWith("--") || args.some((arg, index) => arg !== "--org" && arg !== "--apply" && index !== orgIndex + 1)) {
  throw new Error("Usage: --org <workspace-id> [--apply]");
}
try {
  console.log(JSON.stringify(await backfillProblemSubjects(orgId, { apply: args.includes("--apply") }), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Problem subject update failed");
  process.exitCode = 1;
} finally {
  await databasePool().end();
}
