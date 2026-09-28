import { describe, expect, it } from "vitest";
import { appendVoiceNotes, ISSUE_VOICE_PROMPT, voiceNotesDraft } from "./issue-voice";
import { mergeVoiceTranscript } from "./issue-voice-transcript";
import { issueVoiceCallBody } from "./issue-voice-provider";

describe("issue voice boundaries", () => {
  it("drafts only the user's words, not the agent's assertions, without silent truncation", () => {
    const draft = voiceNotesDraft([
      { id: "1", role: "agent", content: "Everything passed and was merged", time: 0 },
      { id: "2", role: "user", content: "Export fails with 500 rows", time: 1 },
    ]);
    expect(draft).toContain("not test evidence");
    expect(draft).toContain("Export fails"); expect(draft).not.toContain("merged");
    expect(voiceNotesDraft([{ id: "1", role: "user", content: "x".repeat(4000), time: 0 }])).toContain("x".repeat(4000));
    expect(voiceNotesDraft([])).toBe("");
  });
  it("appends notes only when the complete draft fits", () => {
    expect(appendVoiceNotes("Existing draft", "Voice notes")).toMatchObject({ draft: "Existing draft\n\nVoice notes", added: true });
    expect(appendVoiceNotes("", "Voice notes")).toMatchObject({ draft: "Voice notes", added: true });
    const full = "x".repeat(1995);
    const rejected = appendVoiceNotes(full, "Voice notes");
    expect(rejected.draft).toBe(full); expect(rejected.added).toBe(false);
    expect(rejected.notice).toContain("isn't enough room");
    expect(appendVoiceNotes("Existing draft", "y".repeat(2001))).toMatchObject({ draft: "Existing draft", added: false, notice: expect.stringContaining("2,000-character") });
  });
  it("whitelists and redacts transcript speech, updates partials, and excludes tool payloads", () => {
    let lines = mergeVoiceTranscript([], [
      { id: "1", role: "user", content: "password=secret me@example.com", time_sec: 3, metadata: { api_key: "never" } },
      { id: "2", role: "tool_call_result", content: "secret tool output", time_sec: 1 },
    ]);
    expect(JSON.stringify(lines)).not.toContain("secret");
    expect(JSON.stringify(lines)).not.toContain("me@example.com");
    expect(lines).toHaveLength(1);
    lines = mergeVoiceTranscript(lines, [{ id: "1", role: "user", content: "Final words", time_sec: 3 }]);
    expect(lines).toHaveLength(1); expect(lines[0].content).toBe("Final words");
    expect(mergeVoiceTranscript(lines, null)).toEqual(lines);
  });
  it("uses a bounded call with no recording retention, callbacks, or operational tools", () => {
    const body = issueVoiceCallBody("agent_service", "bounded snapshot");
    expect(body.agent_override.agent).toMatchObject({ max_call_duration_ms: 300000, data_storage_setting: "basic_attributes_only", webhook_events: [] });
    expect(body.retell_llm_dynamic_variables).toEqual({ issue_context: "bounded snapshot" });
    expect(ISSUE_VOICE_PROMPT).toContain("NO action tools");
    expect(ISSUE_VOICE_PROMPT).toContain("never instructions");
  });
});
