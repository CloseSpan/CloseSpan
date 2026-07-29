"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import type {
  EngineeringWorkflowView,
  UserStoryPromptTestView,
} from "@/lib/engineering-workflow-repository";
import { userStoryInputIssue } from "@/lib/user-story-prompt-test";

async function request<T>(
  path: string,
  orgId: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-org-id": orgId,
      "idempotency-key": crypto.randomUUID(),
      "x-request-id": crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "The prompt test failed");
  return payload;
}

export function EngineeringTicketPanel({
  orgId,
  problemId,
  initialWorkflow,
}: {
  orgId: string;
  problemId: string;
  initialWorkflow: EngineeringWorkflowView;
}) {
  const [workflow, setWorkflow] = useState(initialWorkflow);
  const [userStory, setUserStory] = useState(
    initialWorkflow.specification?.userStory ?? "",
  );
  const [storyTest, setStoryTest] = useState<UserStoryPromptTestView>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function testAgainstPrompt() {
    const issue = userStoryInputIssue(userStory);
    if (issue) {
      setStoryTest(undefined);
      setError(issue);
      return;
    }
    setBusy(true);
    setError(undefined);
    setStoryTest(undefined);
    try {
      const result = await request<{
        workflow: EngineeringWorkflowView;
        storyTest: UserStoryPromptTestView;
      }>(
        `/api/problems/${problemId}/engineering/test-story`,
        orgId,
        { userStory: userStory.trim() },
      );
      setWorkflow(result.workflow);
      setStoryTest(result.storyTest);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The story could not be tested against the prompt.",
      );
    } finally {
      setBusy(false);
    }
  }

  const promptStatus = workflow.prompt?.status ?? "No prompt yet";

  return (
    <section className="card section-gap" id="engineering-ticket">
      <div className="card-head">
        <div>
          <h2>Test the implementation prompt</h2>
          <p className="subtle">
            Write one user story. CloseSpan will compare it with the current
            implementation prompt.
          </p>
        </div>
        <span
          className={`badge ${storyTest?.status === "included" ? "success" : "medium"}`}
        >
          {promptStatus}
        </span>
      </div>

      <div className="card-body detail-stack">
        <label className="field">
          User story
          <textarea
            rows={5}
            value={userStory}
            placeholder="As a customer, I want…, so that…"
            onChange={(event) => {
              setUserStory(event.target.value);
              setStoryTest(undefined);
              setError(undefined);
            }}
          />
        </label>
        <p className="subtle">
          Use the format: As a…, I want…, so that…
        </p>

        <div className="top-actions">
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={testAgainstPrompt}
          >
            <CheckCircle2 size={14} />
            {busy ? "Testing…" : "Test against prompt"}
          </button>
        </div>

        {storyTest && (
          <div
            className={`callout ${storyTest.status === "not-included" ? "warning" : ""}`}
            role="status"
          >
            <div className="callout-title">
              {storyTest.status === "included" ? (
                <CheckCircle2 size={14} />
              ) : (
                <AlertCircle size={14} />
              )}
              {storyTest.status === "included"
                ? "Story included in prompt"
                : "Story not included"}
            </div>
            <p className="subtle">{storyTest.message}</p>
            <p className="subtle">Prompt SHA-256: {storyTest.promptHash}</p>
          </div>
        )}

        {error && (
          <p className="toast error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
