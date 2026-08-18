import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const proxy = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("./pipedream", () => ({
  getPipedreamClient: () => ({ proxy }),
  pipedreamExternalUserId: (orgId: string) => `feelow:${orgId}`,
}));

import {
  joinSlackChannel,
  listSlackChannelMessages,
  listSlackThreadReplies,
  postSlackMessage,
} from "./slack-api";

describe("Slack history polling", () => {
  beforeEach(() => {
    proxy.get.mockReset().mockResolvedValue({ ok: true, messages: [] });
    vi.spyOn(Date, "now").mockReturnValue(1_786_607_401_123);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("adds a fresh Slack time boundary to channel history requests", async () => {
    await listSlackChannelMessages(
      { orgId: "org_test", accountId: "apn_test" },
      "C123",
      "1786591789.000000",
    );

    expect(proxy.get).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          oldest: "1786591789.000000",
          latest: "1786607401.123000",
        }),
      }),
      { timeoutInSeconds: 10 },
    );
  });

  it("adds a fresh Slack time boundary to thread reply requests", async () => {
    await listSlackThreadReplies(
      { orgId: "org_test", accountId: "apn_test" },
      "C123",
      "1786607401.192349",
    );

    expect(proxy.get).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          ts: "1786607401.192349",
          latest: "1786607401.123000",
        }),
      }),
      { timeoutInSeconds: 10 },
    );
  });

  it("uses the CloseSpan bot token directly for visible bot messages", async () => {
    const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      void url;
      void init;
      return new Response(JSON.stringify({ ok: true, ts: "1786607401.999000" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", request);
    const context = { orgId: "org_test", accessToken: "xoxb-closespan" };

    await joinSlackChannel(context, "C123");
    await postSlackMessage(context, {
      channelId: "C123",
      text: "Feedback recorded.",
      threadTs: "1786607401.100000",
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer xoxb-closespan",
    });
    expect(proxy.post).not.toHaveBeenCalled();
  });
});
