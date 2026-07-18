import { NextResponse } from "next/server";
import { databaseHealth, persistenceMode } from "@/lib/db";
import { getAiPublicConfiguration } from "@/lib/ai-config";
import { ORG_ID } from "@/lib/seed";

export async function GET() {
  const mode = process.env.APP_MODE ?? (process.env.NODE_ENV === "production" ? "production" : "demo");
  const persistence = persistenceMode();
  const database = await databaseHealth();
  const ai = await getAiPublicConfiguration(ORG_ID);
  return NextResponse.json({ status: database ? "ok" : "degraded", mode, persistence, database: database ? "connected" : "unavailable", ai:{provider:ai.provider,providerLabel:ai.providerLabel,model:ai.model,configured:ai.configured,keySource:ai.keySource,vaultConfigured:ai.vaultConfigured}, timestamp: new Date().toISOString() }, { status: database ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
