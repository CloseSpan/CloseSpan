import { NextResponse } from "next/server";
import { databaseHealth, persistenceMode } from "@/lib/db";

export async function GET() {
  const mode = process.env.APP_MODE ?? (process.env.NODE_ENV === "production" ? "production" : "demo");
  const persistence = persistenceMode();
  const database = await databaseHealth();
  return NextResponse.json({ status: database ? "ok" : "degraded", mode, persistence, database: database ? "connected" : "unavailable", timestamp: new Date().toISOString() }, { status: database ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
