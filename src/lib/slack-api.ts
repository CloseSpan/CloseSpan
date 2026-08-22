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
  deleted_ts?: string;
  hidden?: boolean;
  edited?: { user?: string; ts?: string };
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

export interface SlackBotContext {
  orgId: string;
  accessToken: string;
}

export type SlackApiContext = SlackProxyContext | SlackBotContext;

function isSlackBotContext(
  context: SlackApiContext,
): context is SlackBotContext {
  return "accessToken" in context;
}

export async function getSlackIdentity(
  context: SlackApiContext,
): Promise<{ userId: string }> {
  const response = await slackGet(context, "auth.test");
  if (typeof response.user_id !== "string" || !response.user_id.trim())
    throw new SlackApiError("auth.test", "missing_user_id");
  return { userId: response.user_id };
}

async function slackGet(
  context: SlackApiContext,
  method: string,
  params?: Record<string, string>,
): Promise<SlackResponse> {
  if (isSlackBotContext(context)) {
    const url = new URL(`${SLACK_API}/${method}`);
    for (const [name, value] of Object.entries(params ?? {}))
      url.searchParams.set(name, value);
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${context.accessToken}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new SlackApiError(method, `http_${response.status}`);
    return responseObject(await response.json(), method);
  }
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
  context: SlackApiContext,
  method: string,
  body: Record<string, unknown>,
): Promise<SlackResponse> {
  if (isSlackBotContext(context)) {
    const response = await fetch(`${SLACK_API}/${method}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${context.accessToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new SlackApiError(method, `http_${response.status}`);
    return responseObject(await response.json(), method);
  }
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

export async function getSlackTeam(context: SlackApiContext): Promise<{
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
  context: SlackApiContext,
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
  context: SlackApiContext,
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
  context: SlackApiContext,
  channelId: string,
  purpose =
    "Product conversations monitored by CloseSpan. Clear feedback is recorded, ambiguous feedback requires confirmation, and casual chat is ignored.",
): Promise<void> {
  await slackPost(context, "conversations.setPurpose", {
    channel: channelId,
    purpose,
  });
}

export async function postSlackMessage(
  context: SlackApiContext,
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

export async function updateSlackMessage(
  context: SlackApiContext,
  input: {
    channelId: string;
    messageTs: string;
    text: string;
    blocks?: unknown[];
  },
): Promise<void> {
  await slackPost(context, "chat.update", {
    channel: input.channelId,
    ts: input.messageTs,
    text: input.text,
    ...(input.blocks ? { blocks: input.blocks } : {}),
  });
}

export async function listSlackChannelMessages(
  context: SlackApiContext,
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
  context: SlackApiContext,
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

export async function joinSlackChannel(
  context: SlackApiContext,
  channelId: string,
): Promise<void> {
  await slackPost(context, "conversations.join", { channel: channelId });
}
