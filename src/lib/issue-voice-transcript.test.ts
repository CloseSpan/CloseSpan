import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { voiceTranscriptStream } from "./issue-voice-transcript";

class FakeSocket {
  static sockets: FakeSocket[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(public url: string, public protocols: string[]) { FakeSocket.sockets.push(this); }
}
beforeEach(() => { vi.useFakeTimers(); FakeSocket.sockets = []; vi.stubGlobal("WebSocket", FakeSocket); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("voice transcript lifecycle", () => {
  it("relays only redacted speech, not tools or provider metadata", async () => {
    const stream = voiceTranscriptStream("call_test", "server-key", new AbortController().signal);
    const reader = stream.getReader();
    FakeSocket.sockets[0].onmessage?.({ data: JSON.stringify({ type: "transcript", apiKey: "server-key", transcripts: [
      { id: "one", role: "user", content: "Email me at person@example.com", time_sec: 1 },
      { id: "two", role: "tool", content: "secret", time_sec: 2 },
    ] }) });
    const frame = new TextDecoder().decode((await reader.read()).value);
    expect(frame).toContain("transcript"); expect(frame).not.toContain("person@example.com"); expect(frame).not.toContain("server-key"); expect(frame).not.toContain("secret");
    await reader.cancel();
    expect(FakeSocket.sockets[0].close).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not end a media call just because captions disconnect", async () => {
    const reader = voiceTranscriptStream("call_test", "key", new AbortController().signal).getReader();
    FakeSocket.sockets[0].onclose?.({ code: 1000 });
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("unavailable");
    expect((await reader.read()).done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("ends on an explicit provider end event and aborts promptly on navigation", async () => {
    const controller = new AbortController();
    const reader = voiceTranscriptStream("call_test", "key", controller.signal).getReader();
    controller.abort();
    expect((await reader.read()).done).toBe(true);
    expect(FakeSocket.sockets[0].close).toHaveBeenCalled();
    const next = voiceTranscriptStream("call_next", "key", new AbortController().signal).getReader();
    FakeSocket.sockets[1].onmessage?.({ data: '{"type":"call_ended"}' });
    expect(new TextDecoder().decode((await next.read()).value)).toContain("ended");
    expect((await next.read()).done).toBe(true);
  });
  it("limits monitoring to five minutes", async () => {
    const reader = voiceTranscriptStream("call_test", "key", new AbortController().signal).getReader();
    await vi.advanceTimersByTimeAsync(300000);
    let result = await reader.read();
    while (!result.done) result = await reader.read();
    expect(FakeSocket.sockets[0].close).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
