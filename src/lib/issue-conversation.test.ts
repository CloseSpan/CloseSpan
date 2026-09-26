import { describe, expect, it } from "vitest";
import { boundedIssueConversationEvidence, issueConversationMessageSchema, sanitizeIssueConversationText } from "./issue-conversation";

describe("issue discussion data boundaries", () => {
  it("accepts only a bounded message, never browser-supplied history, evidence, or actions", () => {
    expect(issueConversationMessageSchema.parse({ message: " Why did this happen? " })).toEqual({ message: "Why did this happen?" });
    for (const body of [null, { message: "" }, { message: "a".repeat(2001) },
      { message: "Hello", history: [] }, { message: "Hello", evidence: { tests: "passed" } },
      { message: "Hello", approve: true }]) {
      expect(issueConversationMessageSchema.safeParse(body).success).toBe(false);
    }
  });

  it("redacts recognizable credentials and personal contact details before storage or inference", () => {
    const text = "sam@example.com password=hunter2 token=abc sk-proj-abcdefghijklmno ghp_abcdefghijklmno Bearer auth-token";
    const safe = sanitizeIssueConversationText(text);
    expect(safe).not.toMatch(/sam@|hunter2|token=abc|sk-proj-|ghp_|auth-token/);
    expect(safe).toContain("[REDACTED_SECRET]");
    expect(sanitizeIssueConversationText("a".repeat(9000))).toHaveLength(4000);
  });

  it("bounds report counts, nested content, and text budget", () => {
    const output = boundedIssueConversationEvidence({ reports: Array.from({ length: 80 }, () => ({ quote: "a".repeat(10000) })) }, 5000) as { reports: Array<{ quote: string }> };
    expect(output.reports).toHaveLength(12);
    expect(JSON.stringify(output).length).toBeLessThan(5500);
    expect(output.reports[0].quote).toHaveLength(2000);
  });
});
