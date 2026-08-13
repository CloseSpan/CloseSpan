import { getPipedreamClient, pipedreamExternalUserId } from "./pipedream";

const SLACK_API = "https://slack.com/api";

export interface SlackChannel {
  id: string;
  name: string;
  is_archived?: boolean;
  is_member?: boolean;
}

export interface SlackReaction {
  name: string;
  count: number;
}

export interface SlackFile {
  id: string;
  name?: string;
  title?: string;
  mimetype?: string;
  size?: number;
}

export interface SlackMessage {
  type?: string;
  subtype?: string;
  ts: string;
  thread_ts?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  reactions?: SlackReaction[];
  files?: SlackFile[];
  reply_count?: number;
}

type SlackResponse = Record<string, unknown> & {
  ok?: boolean;
  error?: string;
  response_metadata?: { next_cursor?: string };
};

export class SlackApiError extends Error {
  constructor(
    public readonly method: string,
    public readonly code: string,
  ) {
    super(`Slack ${method} failed: ${code}`);
    this.name = "SlackApiError";
  }
}

function responseObject(value: unknown, method: string): SlackResponse {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SlackApiError(method, "invalid_response");
  const response = value as SlackResponse;
  if (response.ok !== true)
    throw new SlackApiError(method, response.error || "unknown_error");
  return response;
}

export interface SlackProxyContext {
  orgId: string;
  accountId: string;
}

async function slackGet(
  context: SlackProxyContext,
  method: string,
  params?: Record<string, string>,
): Promise<SlackResponse> {
  const response = await getPipedreamClient().proxy.get(
    {
      url: `${SLACK_API}/${method}`,
      externalUserId: pipedreamExternalUserId(context.orgId),
      accountId: context.accountId,
      params,
      headers: { Accept: "application/json" },
    },
    { timeoutInSeconds: 10 },
  );
  return responseObject(response, method);
}

async function slackPost(
  context: SlackProxyContext,
  method: string,
  body: Record<string, unknown>,
): Promise<SlackResponse> {
  const response = await getPipedreamClient().proxy.post(
    {
      url: `${SLACK_API}/${method}`,
      externalUserId: pipedreamExternalUserId(context.orgId),
      accountId: context.accountId,
      body,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json; charset=utf-8",
      },
    },
    { timeoutInSeconds: 10 },
  );
  return responseObject(response, method);
}

export async function getSlackTeam(context: SlackProxyContext): Promise<{
  id: string;
  name: string | null;
}> {
  const response = await slackGet(context, "team.info");
  const team = response.team as { id?: unknown; name?: unknown } | undefined;
  if (!team || typeof team.id !== "string")
    throw new SlackApiError("team.info", "missing_team");
  return {
    id: team.id,
    name: typeof team.name === "string" ? team.name : null,
  };
}

export async function findPublicSlackChannel(
  context: SlackProxyContext,
  name: string,
): Promise<SlackChannel | null> {
  let cursor = "";
  for (let page = 0; page < 5; page += 1) {
    const response = await slackGet(context, "conversations.list", {
      exclude_archived: "true",
      limit: "200",
      types: "public_channel",
      ...(cursor ? { cursor } : {}),
    });
    const channels = Array.isArray(response.channels)
      ? response.channels as SlackChannel[]
      : [];
    const match = channels.find(
      (channel) => channel.name === name && !channel.is_archived,
    );
    if (match) return match;
    cursor = response.response_metadata?.next_cursor?.trim() ?? "";
    if (!cursor) break;
  }
  return null;
}

export async function createPublicSlackChannel(
  context: SlackProxyContext,
  name: string,
): Promise<SlackChannel> {
  try {
    const response = await slackPost(context, "conversations.create", {
      name,
      is_private: false,
    });
    const channel = response.channel as SlackChannel | undefined;
    if (!channel?.id) throw new SlackApiError("conversations.create", "missing_channel");
    return channel;
  } catch (error) {
    if (error instanceof SlackApiError && error.code === "name_taken") {
      const existing = await findPublicSlackChannel(context, name);
      if (existing) return existing;
    }
    throw error;
  }
}

export async function setSlackChannelPurpose(
  context: SlackProxyContext,
  channelId: string,
): Promise<void> {
  await slackPost(context, "conversations.setPurpose", {
    channel: channelId,
    purpose:
      "Customer feedback monitored by CloseSpan. One thread is created per Product Problem; human action is requested only for approval, scope changes, and release verification.",
  });
}

export async function postSlackMessage(
  context: SlackProxyContext,
  input: {
    channelId: string;
    text: string;
    blocks?: unknown[];
    threadTs?: string;
  },
): Promise<{ ts: string }> {
  const response = await slackPost(context, "chat.postMessage", {
    channel: input.channelId,
    text: input.text,
    ...(input.blocks ? { blocks: input.blocks } : {}),
    ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
    unfurl_links: false,
    unfurl_media: false,
  });
  if (typeof response.ts !== "string")
    throw new SlackApiError("chat.postMessage", "missing_timestamp");
  return { ts: response.ts };
}

export async function listSlackChannelMessages(
  context: SlackProxyContext,
  channelId: string,
  oldest: string,
): Promise<SlackMessage[]> {
  const response = await slackGet(context, "conversations.history", {
    channel: channelId,
    oldest,
    // Pipedream may cache identical proxy GET URLs. A fresh, valid Slack time
    // boundary keeps polling requests distinct without adding unknown params.
    latest: (Date.now() / 1_000).toFixed(6),
    inclusive: "false",
    limit: "100",
  });
  return Array.isArray(response.messages)
    ? response.messages as SlackMessage[]
    : [];
}

export async function listSlackThreadReplies(
  context: SlackProxyContext,
  channelId: string,
  threadTs: string,
): Promise<SlackMessage[]> {
  const response = await slackGet(context, "conversations.replies", {
    channel: channelId,
    ts: threadTs,
    latest: (Date.now() / 1_000).toFixed(6),
    limit: "100",
  });
  return Array.isArray(response.messages)
    ? response.messages as SlackMessage[]
    : [];
}
