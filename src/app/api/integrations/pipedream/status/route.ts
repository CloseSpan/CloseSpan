import { NextRequest, NextResponse } from "next/server";
import type { Account } from "@pipedream/sdk";
import { z } from "zod";
import { getPipedreamClient, pipedreamExternalUserId } from "@/lib/pipedream";
import {
  PIPEDREAM_CONNECTOR_IDS,
  pipedreamAppSlug,
} from "@/lib/pipedream-connectors";
import {
  listPipedreamConnections,
  reconcilePipedreamAccounts,
  savePipedreamAccount,
} from "@/lib/pipedream-repository";
import {
  authorizeAdminMutation,
  errorResponse,
  HttpError,
  noStoreHeaders,
} from "@/lib/request-security";

export const runtime = "nodejs";
const schema = z.object({ integrationId: z.enum(PIPEDREAM_CONNECTOR_IDS) }).strict();

export async function POST(request: NextRequest) {
  try {
    const context = await authorizeAdminMutation(request);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "Select a supported connector.");
    const integrationId = parsed.data.integrationId;
    const app = pipedreamAppSlug(integrationId);
    const externalUserId = pipedreamExternalUserId(context.orgId);
    const verifiedBefore = new Date();
    const page = await getPipedreamClient().accounts.list({
      externalUserId,
      app,
      limit: 100,
    });
    const upstreamAccounts: Account[] = [];
    for await (const account of page) {
      upstreamAccounts.push(account);
      await savePipedreamAccount({
        orgId: context.orgId,
        integrationId,
        externalUserId,
        actorId: context.actorId,
        account,
      });
    }
    await reconcilePipedreamAccounts({
      orgId: context.orgId,
      integrationId,
      upstreamAccountIds: upstreamAccounts.map((account) => account.id),
      verifiedBefore,
    });
    const accounts = (await listPipedreamConnections(context.orgId))
      .filter((item) => item.integrationId === integrationId);
    let slackIntake = null;
    let slackSetupWarning: string | null = null;
    if (integrationId === "int_slack") {
      const connectedAccount = accounts.find((item) => item.state === "Connected");
      if (connectedAccount) {
        try {
          const { ensureSlackIntakeChannel } = await import("@/lib/slack-intake");
          slackIntake = await ensureSlackIntakeChannel({
            orgId: context.orgId,
            accountId: connectedAccount.accountId,
            actorId: context.actorId,
            actorName: context.actorName,
            traceId: `${context.traceId}:slack-intake`,
          });
        } catch (error) {
          console.error("[slack:intake-provision]", {
            orgId: context.orgId,
            errorType: error instanceof Error ? error.name : "UnknownError",
          });
          slackSetupWarning =
            "Slack is connected, but #closespan-feedback could not be prepared yet. CloseSpan will retry automatically.";
        }
      }
    }
    return NextResponse.json({
      integrationId,
      connectionState: accounts.some((item) => item.state === "Connected")
        ? "Connected"
        : accounts.some((item) => item.state === "Needs reconnect")
          ? "Needs reconnect"
          : "Disconnected",
      accounts,
      ...(integrationId === "int_slack"
        ? { slackIntake, slackSetupWarning }
        : {}),
    }, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof HttpError) return errorResponse(error);
    console.error("[pipedream:status]", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return errorResponse(new HttpError(503, "Connection status is unavailable right now."));
  }
}
