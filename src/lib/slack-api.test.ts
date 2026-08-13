import { beforeEach, describe, expect, it, vi } from "vitest";

const proxy = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("./pipedream", () => ({
  getPipedreamClient: () => ({ proxy }),
  pipedreamExternalUserId: (orgId: string) => `feelow:${orgId}`,
}));

import {
  listSlackChannelMessages,
  listSlackThreadReplies,
} from "./slack-api";

describe("Slack history polling", () => {
  beforeEach(() => {
    proxy.get.mockReset().mockResolvedValue({ ok: true, messages: [] });
    vi.spyOn(Date, "now").mockReturnValue(1_786_607_401_123);
  });

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
});
