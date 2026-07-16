import { NextResponse } from "next/server";

export function GET() {
  const mode = process.env.APP_MODE ?? (process.env.NODE_ENV === "production" ? "production" : "demo");
  return NextResponse.json({ status: "ok", mode, timestamp: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
