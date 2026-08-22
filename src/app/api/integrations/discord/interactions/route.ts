import { NextRequest } from "next/server";
import { discordInteractionResponse, verifyDiscordInteractionSignature } from "@/lib/discord-interactions";
import { processDiscordMessage, reviewDiscordCandidate, type DiscordMessageEvent } from "@/lib/discord-intake";
import { errorResponse, HttpError } from "@/lib/request-security";

export const runtime = "nodejs";

type Option = { name?: string; value?: string; options?: Option[] };
type Interaction = {
  id: string;
  type: number;
  guild_id?: string;
  channel_id?: string;
  member?: { user?: DiscordMessageEvent["author"] };
  data?: { name?: string; custom_id?: string; target_id?: string; options?: Option[]; resolved?: { messages?: Record<string, DiscordMessageEvent> } };
};

function slashValue(options: Option[] = []): string {
  return options.flatMap((option) => option.options ?? [option]).find((option) => option.name === "feedback")?.value?.trim() ?? "";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    verifyDiscordInteractionSignature({
      body,
      signature: request.headers.get("x-signature-ed25519"),
      timestamp: request.headers.get("x-signature-timestamp"),
    });
    const interaction = JSON.parse(body) as Interaction;
    if (interaction.type === 1) return Response.json({ type: 1 });
    if (!interaction.guild_id || !interaction.channel_id) throw new HttpError(400, "Discord interaction is missing server context.");
    if (interaction.type === 3) {
      const match = /^closespan:(confirm|ignore):(dc_[a-f0-9]{24})$/.exec(interaction.data?.custom_id ?? "");
      if (!match) throw new HttpError(400, "Discord confirmation action is invalid.");
      const actorId = interaction.member?.user?.id;
      if (!actorId) throw new HttpError(400, "Discord confirmation is missing member context.");
      const reviewed = await reviewDiscordCandidate({ guildId: interaction.guild_id, decision: match[1] === "confirm" ? "confirm" : "ignore", candidateId: match[2], actorId });
      return discordInteractionResponse(reviewed.recorded ? `Recorded as **${reviewed.classification.toLowerCase()}** feedback.` : "Ignored. Nothing was recorded.", { update: true });
    }
    if (interaction.type !== 2) throw new HttpError(400, "Unsupported Discord interaction.");
    const targetId = interaction.data?.target_id;
    const target = targetId ? interaction.data?.resolved?.messages?.[targetId] : undefined;
    const content = target?.content?.trim() || slashValue(interaction.data?.options);
    if (!content) return discordInteractionResponse("Add the feedback you want CloseSpan to review.", { ephemeral: true });
    const result = await processDiscordMessage({
      id: target?.id || interaction.id,
      guild_id: interaction.guild_id,
      channel_id: interaction.channel_id,
      content,
      author: target?.author || interaction.member?.user,
      mentions: [],
    }, {
      forceReport: true,
      postConfirmation: false,
      confirmationActorId: interaction.member?.user?.id,
    });
    if (!result?.candidateId) return discordInteractionResponse("CloseSpan could not prepare this report. Confirm that this server is connected.", { ephemeral: true });
    return Response.json({ type: 4, data: {
      content: `You asked CloseSpan to report this as **${result.classification.toLowerCase()}**. Nothing has been recorded yet.`,
      flags: 64,
      allowed_mentions: { parse: [] },
      components: [
        { type: 1, components: [
          { type: 2, style: 3, label: "Record feedback", custom_id: `closespan:confirm:${result.candidateId}` },
          { type: 2, style: 2, label: "Ignore", custom_id: `closespan:ignore:${result.candidateId}` },
        ] },
      ],
    } });
  } catch (error) { return errorResponse(error); }
}
