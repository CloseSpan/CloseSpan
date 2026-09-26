import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { IssueConversation, type IssueConversationProps } from "./issue-conversation";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const base: IssueConversationProps = {
  problemId: "issue", initial: { messages: [], storageReady: true, pending: false },
  currentPromptHash: "a".repeat(64), canDiscuss: true, canRevise: true, canTest: true, demo: false, reviewVersion: 1,
};
const proposal = { summary: "Cover empty input", revisedPrompt: "Revised requirement", currentPromptHash: "a".repeat(64), revisionReceipt: "receipt", message: "Check empty input" };
describe("issue conversation", () => {
  it("offers one contextual composer with an explicitly separate scenario check", () => {
    const html = renderToStaticMarkup(<IssueConversation {...base} />);
    expect(html).toContain('role="log"');
    expect(html).toContain("Message CloseSpan");
    expect(html).toContain("Check scenario");
    expect(html).toContain("Discussion does not authorize coding or merging.");
    expect(html).not.toContain("Approve and merge");
  });
  it("shows persisted messages as text, not trusted markup", () => {
    const html = renderToStaticMarkup(<IssueConversation {...base} initial={{ ...base.initial,
      messages: [{ id: "m", role: "user", content: "<script>bad()</script>", createdAt: "2026-09-15" }],
    }} />);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
  it("never enables discussion or tests for presentation samples", () => {
    const html = renderToStaticMarkup(<IssueConversation {...base} demo sampleOutcome="The export contains every selected row." />);
    expect(html).toContain("sample response");
    expect(html).toContain("The export contains every selected row.");
    expect(html).toContain("Read-only demo");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<textarea");
  });
  it("handles missing storage and viewer access without a misleading composer", () => {
    expect(renderToStaticMarkup(<IssueConversation {...base} initial={{ ...base.initial, storageReady: false }} />)).toContain("Conversation setup is pending");
    expect(renderToStaticMarkup(<IssueConversation {...base} canDiscuss={false} />)).not.toContain("<textarea");
  });
  it("only offers an explicit requirement update for an editable current version", () => {
    const initial = { ...base.initial, messages: [{ id: "m", role: "assistant" as const, content: "Consider an empty-input check.", createdAt: "2026-09-15", proposal }] };
    expect(renderToStaticMarkup(<IssueConversation {...base} initial={initial} />)).toContain("Request this change");
    expect(renderToStaticMarkup(<IssueConversation {...base} initial={initial} canRevise={false} />)).not.toContain("Request this change");
    expect(renderToStaticMarkup(<IssueConversation {...base} initial={initial} currentPromptHash={"b".repeat(64)} />)).toContain("An earlier requirement version");
  });
  it("does not describe a scenario pass as application verification or show stale checks", () => {
    const initialCheck = { verdict: "Passed" as const, summary: "The scenario is covered.", changes: [], promptHash: "a".repeat(64) };
    const html = renderToStaticMarkup(<IssueConversation {...base} initialCheck={initialCheck} />);
    expect(html).toContain("Scenario covered");
    expect(html).toContain("not a live application test");
    expect(renderToStaticMarkup(<IssueConversation {...base} initialCheck={{ ...initialCheck, promptHash: "b".repeat(64) }} />)).not.toContain("Scenario covered");
  });
});
