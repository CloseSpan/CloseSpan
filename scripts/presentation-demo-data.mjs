import { createHash, randomUUID } from "node:crypto";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const scenarios = {
  prob_demo_export: {
    state: "review",
    expected: "Exporting more than 10,000 rows produces a complete CSV. Show success only after the file is saved; show a retryable error if saving fails.",
    criteria: ["A 10,001-row export contains all selected rows.", "A failed storage commit never shows a successful export."],
  },
  prob_demo_billing: {
    state: "review",
    expected: "Workspace owners receive one usage alert at 80% and 90% of their monthly limit, before an overage. Owners can change those thresholds.",
    criteria: ["Crossing 80% delivers one alert within five minutes.", "Retrying the same usage event does not send a duplicate alert."],
  },
  prob_demo_sso: {
    state: "question",
    expected: "SSO setup preserves entered configuration when the administrator signs in again. Certificate validation and access restrictions remain unchanged.",
    criteria: ["Reauthentication restores the saved setup step.", "An expired session cannot change identity-provider settings."],
    question: "Confirm whether the saved SSO setup should expire after 24 hours or seven days.",
  },
  prob_demo_mobile: {
    state: "improve",
    expected: "Changing dashboard filters repeatedly keeps the mobile app responsive and always displays data for the latest selection.",
    criteria: ["Ten rapid filter changes do not freeze the dashboard.", "An older request cannot overwrite the latest filter result."],
    result: "Cancelled stale requests and removed a repeated subscription. The responsiveness check passes; the slow-network check still reproduces an out-of-order result.",
    risk: "An earlier request can still replace the latest result on a slow connection.",
  },
  prob_demo_permissions: {
    state: "validated",
    expected: "Administrators can see and export each user's effective permissions, including the group or role that granted access.",
    criteria: ["Each effective permission includes its grant source.", "The CSV export respects the current workspace boundary."],
    result: "Added an effective-access view and a workspace-scoped CSV export. Direct grants and inherited roles are shown together.",
    manual: "Ask the security team to confirm the export columns match its quarterly audit template.",
  },
  prob_demo_import: {
    state: "merge",
    expected: "Re-importing Salesforce contacts updates existing records even when email capitalization changes. Repeating an import never creates duplicates.",
    criteria: ["Mixed-case variants of one email resolve to one contact.", "Repeating the same import creates zero additional contacts."],
    result: "Normalized email addresses before identity lookup and added idempotent import coverage. The sample review and all recorded checks pass; a human still owns the merge decision.",
  },
  prob_demo_notifications: {
    state: "merged",
    expected: "Daily digests arrive at the configured local time, including across daylight-saving changes, and are sent once per workspace per day.",
    criteria: ["A 9 AM digest follows the workspace's timezone.", "A daylight-saving transition never sends two digests."],
    result: "Moved digest scheduling to workspace-local time and added daylight-saving coverage. This sample fix has completed its review and human-merge history.",
  },
  prob_demo_search: {
    state: "closed",
    expected: "Global search includes archived projects only when Include archived is enabled, while continuing to respect project access permissions.",
    criteria: ["Archived projects appear when the archived filter is enabled.", "Projects the user cannot access never appear in search results."],
    result: "Updated archive filtering and search-index coverage. Sample customer confirmation closes the issue after the release check.",
  },
};

export const presentationGuideSteps = [
  { id: "report", title: "Report", path: "/problems/prob_demo_export/reports", description: "Start with the original customer reports.", actionLabel: "See reports", talkingPoints: ["Slack, Discord, and support reports stay attached to an issue.", "All records in this workspace are fictional sample data."] },
  { id: "track", title: "Track", path: "/problems", description: "Related reports become one concise issue.", actionLabel: "See issues", talkingPoints: ["Eight issues show different points in the workflow.", "Linear sync is optional; the internal issue is the source of context."] },
  { id: "requirements", title: "Confirm the outcome", path: "/approvals", description: "A domain expert reviews expected behavior.", actionLabel: "See review inbox", talkingPoints: ["Two sample requirements are ready to review.", "Presentation controls cannot start real work."] },
  { id: "implement", title: "Implement and review", path: "/problems/prob_demo_permissions", description: "The agent prepares a change and its checks in the background.", actionLabel: "See sample result", talkingPoints: ["The user sees the result, not infrastructure controls.", "Recorded test evidence is simulated for this presentation."] },
  { id: "improve", title: "Improve", path: "/problems/prob_demo_mobile", description: "A failed check sends the fix back for improvement.", actionLabel: "See failed check", talkingPoints: ["One failed behavior check stays visible.", "A proposed fix is not treated as verified until checks pass."] },
  { id: "validate", title: "Validate and human merge", path: "/problems/prob_demo_import", description: "Review the sample test results and final human decision boundary.", actionLabel: "See merge review", talkingPoints: ["CloseSpan coordinates review and independent Tenki validation.", "This demo contains no real PR or sandbox; no merge will execute."] },
  { id: "close", title: "Close the loop", path: "/problems/prob_demo_notifications", description: "Finish with the sample merge history and affected customers.", actionLabel: "See completed result", talkingPoints: ["The original reports stay linked through delivery.", "Customer follow-up drafts remain unsent."] },
];

// This helper is only called inside the NEW-organization provisioning transaction.
// Table and column names are developer-owned; all fixture values are parameterized.
async function insert(client, table, record) {
  const columns = Object.keys(record);
  if (![table, ...columns].every((name) => /^[a-z_]+$/.test(name))) throw new Error("Invalid fixture identifier");
  const values = Object.values(record).map((value) => value && typeof value === "object" && !(value instanceof Date) ? JSON.stringify(value) : value);
  return client.query(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(",")})`, values);
}

export async function provisionPresentationWorkflow(client, { orgId, memberId, problems, feedback, now }) {
  await client.query(`UPDATE workspace_settings SET autonomy_level='Observe',monthly_model_budget=0,
    used_model_cost=0,hard_stop=true,plan_name='Presentation demo',plan_price='$0',
    prompt_draft_mode='manual',prompt_draft_min_evidence=1,prompt_draft_min_confidence=0.65,
    prompt_draft_reviewer_id=$2,prompt_draft_notify_reviewer=false,prompt_draft_notify_in_app=false,
    prompt_draft_notify_email=false WHERE org_id=$1`, [orgId, memberId]);
  await client.query(`UPDATE workspace_onboarding SET product_profile=product_profile ||
    '{"demoMode":"presentation","description":"Fictional analytics product. Read-only presentation data; no live agent, provider, or deployment activity."}'::jsonb WHERE org_id=$1`, [orgId]);
  await client.query("UPDATE workspaces SET primary_approval_id=NULL,name='Northstar Analytics · presentation demo' WHERE org_id=$1", [orgId]);
  await client.query("UPDATE model_runs SET model='presentation-fixture',input_tokens=0,output_tokens=0 WHERE org_id=$1", [orgId]);
  await client.query("UPDATE integrations SET permissions='[]'::jsonb,data_scope='Sample connector only · no live credentials or imports' WHERE org_id=$1", [orgId]);
  await insert(client, "integrations", { id: "int_discord", org_id: orgId, provider: "Discord", category: "Feedback", connection_state: "Demo connected", permissions: [], data_scope: "Sample community reports · no bot connected", display_order: 4 });

  const completedAt = new Date(now.getTime() - 45 * 60_000);
  const startedAt = new Date(completedAt.getTime() - 6 * 60_000);
  const futureExpiry = new Date(now.getTime() + 30 * 86400_000);
  const pastExpiry = new Date(now.getTime() - 86400_000);
  const output = { requirementReviews: 0, sampleRuns: [], mergeReview: null };
  for (const problem of problems) {
    const scenario = scenarios[problem.id];
    if (!scenario) throw new Error(`Missing presentation scenario: ${problem.id}`);
    const sampleRun = Boolean(scenario.result);
    const failed = scenario.state === "improve";
    const merged = ["merged", "closed"].includes(scenario.state);
    const specificationId = randomUUID();
    const promptId = randomUUID();
    const baseSha = hash(`sample-base:${problem.id}`).slice(0, 40);
    const headSha = hash(`sample-change:${problem.id}`).slice(0, 40);
    const content = `PRESENTATION FIXTURE — DO NOT EXECUTE\n\n${problem.title}\n\n${scenario.expected}`;
    const promptHash = hash(content);
    const criteria = scenario.criteria.map((statement, index) => ({ id: `AC-${index + 1}`, statement, measurable: true }));
    const tests = criteria.map((criterion, index) => ({ id: `TEST-${index + 1}`, title: criterion.statement, given: "The synthetic sample scenario", when: "The user performs the reported workflow", then: criterion.statement, testLevel: "integration", criterionIds: [criterion.id] }));
    const ticket = { userStory: scenario.expected, currentBehavior: problem.statement, expectedBehavior: scenario.expected,
      reproductionSteps: ["Open the affected workflow.", "Perform the action described in the original report."],
      businessOutcome: "Customers complete the workflow without a manual workaround.", acceptanceCriteria: criteria,
      testScenarios: tests, regressionScenarios: ["Existing workspace permissions remain unchanged."], negativeScenarios: ["Failures show an actionable error."],
      qualityExpectations: ["Synthetic data only."], requiredTestLevels: ["integration"], releaseVerification: "Sample release verification; no live application is contacted.",
      nonGoals: ["No live execution, PR creation, messaging, merge, or deployment."], permittedPaths: [...problem.files, "tests/**"], requiredCommands: [], repository: problem.repository, baseBranch: "main", baseSha };
    await insert(client, "engineering_ticket_specifications", { id: specificationId, org_id: orgId, problem_id: problem.id, revision: 1,
      implementation_state: merged ? "Verified" : sampleRun ? "Tests passed" : "Prompt ready", user_story: ticket.userStory,
      current_behavior: ticket.currentBehavior, expected_behavior: ticket.expectedBehavior, reproduction_steps: ticket.reproductionSteps,
      business_outcome: ticket.businessOutcome, regression_scenarios: ticket.regressionScenarios, negative_scenarios: ticket.negativeScenarios,
      quality_expectations: ticket.qualityExpectations, required_test_levels: ticket.requiredTestLevels, release_verification: ticket.releaseVerification,
      non_goals: ticket.nonGoals, permitted_paths: ticket.permittedPaths, required_commands: [], repository: problem.repository,
      base_branch: "main", base_sha: baseSha, created_by: memberId, updated_by: memberId });
    for (const [ordinal, criterion] of criteria.entries()) await insert(client, "engineering_acceptance_criteria", { org_id: orgId, specification_id: specificationId, criterion_id: criterion.id, ordinal, statement: criterion.statement, measurable: true });
    for (const [ordinal, test] of tests.entries()) await insert(client, "engineering_test_scenarios", { org_id: orgId, specification_id: specificationId, scenario_id: test.id, ordinal, title: test.title, given_text: test.given, when_text: test.when, then_text: test.then, test_level: test.testLevel, criterion_ids: test.criterionIds });
    await insert(client, "implementation_prompts", { id: promptId, org_id: orgId, problem_id: problem.id, specification_id: specificationId,
      specification_revision: 1, revision: 1, status: sampleRun ? "Approved" : "Ready", repository: problem.repository, base_branch: "main", base_sha: baseSha,
      artifact_path: `demo/${problem.id}.prompt`, structured_snapshot: { schemaVersion: 1, ticket, evidence: { problemId: problem.id, title: problem.title, statement: problem.statement, summary: problem.summary, severity: problem.severity, confidence: problem.confidence, productArea: problem.productArea, team: problem.team, suspectedRepository: problem.repository, suspectedFiles: problem.files, redactedEvidence: feedback.filter((item) => item.problemId === problem.id).map((item) => item.quote) } }, rendered_content: content, content_hash: promptHash, created_by: memberId, reviewer_id: memberId });
    await insert(client, "problem_prompt_reviews", { org_id: orgId, problem_id: problem.id, status: scenario.state === "question" ? "Needs attention" : sampleRun ? "Awaiting approval" : "Ready",
      prompt_hash: promptHash, user_story: scenario.expected, evaluation: { verdict: scenario.state === "question" ? "Needs revision" : "Passed", summary: "Sample requirement check, not a live model result.", changes: scenario.question ? [scenario.question] : [] }, attempts: 1,
      failure_message: scenario.question ?? null, confirmed_by: sampleRun ? memberId : null, confirmed_at: sampleRun ? startedAt : null });
    if (scenario.state === "review") output.requirementReviews += 1;
    if (!sampleRun) continue;

    const runId = randomUUID();
    const verificationId = randomUUID();
    const approvalId = `apr_sample_${problem.id}`;
    const prNumber = 101 + output.sampleRuns.length;
    const runStatus = failed ? "Failed" : "Tests passed";
    const testResults = criteria.map((criterion, index) => ({ command: `Sample check ${index + 1}`, status: failed && index === 1 ? "failed" : "passed", output: `SIMULATED — ${criterion.statement}` }));
    const criterionResults = criteria.map((criterion, index) => ({ criterionId: criterion.id, status: failed && index === 1 ? "Failed" : "Passed", evidence: `Sample evidence: ${failed && index === 1 ? scenario.risk : criterion.statement}`, scenarioIds: [`TEST-${index + 1}`] }));
    const report = { schemaVersion: 1, runId, promptHash, promptArtifactHash: promptHash, baseSha, status: runStatus,
      summary: `Sample result: ${scenario.result}`, changedFiles: problem.files.map((path) => ({ path, contentBase64: null, reason: "Illustrative change; no repository was modified." })),
      testFiles: [`tests/${problem.id}.test.ts`], tests: testResults, criteria: criterionResults,
      remainingRisks: scenario.risk ? [scenario.risk] : [], assumptions: ["All execution evidence is synthetic presentation data."], manualVerification: scenario.manual ? [scenario.manual] : [], logs: ["Presentation fixture. No sandbox, model, or GitHub request executed."],
      runtimeEvidence: { configured: false, healthStatus: "not_configured", applicationPort: null, previewUrl: null, interactions: [], logExcerpt: [], userStoryReplay: "not_required", userStoryReplayMode: "not_required" },
      independentVerification: { provider: "Tenki Sandbox", sessionId: `sample-only-${runId}`, status: failed ? "failed" : "passed", completedAt: completedAt.toISOString(), durationMs: 12400 } };
    await insert(client, "pdd_prompt_verifications", { id: verificationId, org_id: orgId, problem_id: problem.id, prompt_revision_id: promptId, prompt_hash: promptHash, user_story: scenario.expected, story_hash: hash(scenario.expected), status: "Ready for approval", pdd_version: "presentation", model: "presentation-fixture", budget_usd: 0.01, cost_usd: 0, summary: "Synthetic acceptance contract; no model call.", generated_tests: [], created_by: memberId, started_at: startedAt, completed_at: completedAt });
    await insert(client, "approval_requests", { id: approvalId, org_id: orgId, problem_id: problem.id, recommendation_id: `sample_${problem.id}`, action: `Sample coding decision · ${problem.title}`, reason: "Presentation history only. No execution authority.", confidence: 0.9, systems: ["Simulated"], data_shared: [], reversible: true, risk: "Low", status: "Approved", action_type: "agent_run", prompt_revision_id: promptId, prompt_hash: promptHash, repository: problem.repository, base_branch: "main", base_sha: baseSha, allowed_capabilities: [], expires_at: pastExpiry, consumed_at: startedAt, pdd_verification_id: verificationId });
    await insert(client, "agent_runs", { id: runId, org_id: orgId, problem_id: problem.id, prompt_revision_id: promptId, approval_id: approvalId, pdd_verification_id: verificationId,
      status: runStatus, repository: problem.repository, base_branch: "main", base_sha: baseSha, branch_name: `demo/${problem.id}`, prompt_hash: promptHash,
      changed_files: problem.files, test_results: testResults, implementation_report: report, implementation_commit_sha: headSha,
      pull_request_number: prNumber, pull_request_url: null, queued_at: startedAt, started_at: startedAt, completed_at: completedAt,
      failure_code: failed ? "SAMPLE_CHECK_FAILED" : null, failure_message: failed ? scenario.risk : null });
    for (const criterion of criterionResults) await insert(client, "agent_run_criterion_results", { org_id: orgId, run_id: runId, criterion_id: criterion.criterionId, status: criterion.status, evidence: criterion.evidence, scenario_ids: criterion.scenarioIds });
    await insert(client, "tenki_pr_review_cycles", { id: randomUUID(), org_id: orgId, problem_id: problem.id, root_run_id: runId, repository: problem.repository, pull_request_number: prNumber, review_id: prNumber, cycle: 1, state: failed ? "Blocked" : "Approved", reviewer_login: "sample-reviewer", review_body: failed ? scenario.risk : "Sample review: the recorded change meets the requirement.", head_sha_before: headSha, head_sha_after: headSha, completed_at: completedAt });
    output.sampleRuns.push({ problemId: problem.id, runId });

    if (scenario.state === "merge" || merged) {
      const finalId = `apr_merge_${problem.id}`;
      // Required URL column points to local sample evidence, never an invented GitHub PR.
      const sampleUrl = `http://localhost:3000/agent-runs/${runId}`;
      await insert(client, "approval_requests", { id: finalId, org_id: orgId, problem_id: problem.id, recommendation_id: `sample_${problem.id}`, action: `Sample human merge · ${problem.title}`, reason: "Read-only presentation. No real PR exists and no merge can execute.", confidence: 0.9, systems: ["Simulated"], data_shared: [], reversible: true, risk: "Low", status: merged ? "Approved" : "Pending", action_type: "final_execution", prompt_revision_id: promptId, prompt_hash: promptHash, repository: problem.repository, base_branch: "main", base_sha: baseSha, allowed_capabilities: [], expires_at: futureExpiry, consumed_at: merged ? completedAt : null, agent_run_id: runId, pull_request_number: prNumber, pull_request_url: sampleUrl, head_sha: headSha, evidence_snapshot: { presentationDemo: true, changedFiles: problem.files, testSummary: { passed: 2, failed: 0, skipped: 0 }, acceptanceSummary: { passed: 2, unresolved: 0 }, remainingRisks: [] } });
      if (scenario.state === "merge") output.mergeReview = finalId;
      if (merged) {
        await insert(client, "final_execution_attempts", { id: randomUUID(), org_id: orgId, approval_id: finalId, agent_run_id: runId, action: "merge_pull_request", status: "Succeeded", repository: problem.repository, pull_request_number: prNumber, expected_head_sha: headSha, result_sha: headSha, result_url: sampleUrl, started_at: startedAt, completed_at: completedAt });
        await insert(client, "engineering_release_verifications", { id: randomUUID(), org_id: orgId, problem_id: problem.id, specification_id: specificationId, specification_revision: 1, status: "Passed", environment: "Presentation fixture", evidence: "Synthetic release check. No production deployment or application test occurred.", verified_by: memberId });
      }
    }
  }
  await client.query("UPDATE product_problems SET stage='Release Ready' WHERE org_id=$1 AND id='prob_demo_import'", [orgId]);
  await client.query("UPDATE product_problems SET stage='In progress' WHERE org_id=$1 AND id='prob_demo_mobile'", [orgId]);
  const safety = await client.query(`SELECT
    (SELECT count(*) FROM agent_runs WHERE org_id=$1 AND status IN ('Queued','Running'))+
    (SELECT count(*) FROM final_execution_attempts WHERE org_id=$1 AND status IN ('Queued','Running'))+
    (SELECT count(*) FROM pdd_prompt_verifications WHERE org_id=$1 AND status IN ('Queued','Generating tests'))+
    (SELECT count(*) FROM problem_prompt_reviews WHERE org_id=$1 AND status IN ('Queued','Testing','Waiting for verification','Confirmed','Preparing tests'))+
    (SELECT count(*) FROM pipedream_connections WHERE org_id=$1)+
    (SELECT count(*) FROM github_repository_allowlists WHERE org_id=$1) AS unsafe_records`, [orgId]);
  if (Number(safety.rows[0].unsafe_records) !== 0) throw new Error("Presentation demo must have no executable jobs or live connections");
  return output;
}
