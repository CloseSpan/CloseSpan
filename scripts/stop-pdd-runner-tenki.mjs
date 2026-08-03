import process from "node:process";
import { TenkiSandbox } from "@tenkicloud/sandbox";

const apiKey = process.env.TENKI_API_KEY?.trim();
if (!apiKey) throw new Error("TENKI_API_KEY is required");

const client = new TenkiSandbox({ authToken: apiKey, timeoutMs: 60_000 });
try {
  const sessions = await client.list({ tags: ["pdd-runner"] });
  const active = sessions.filter((session) => !["TERMINATED", "TERMINATING"].includes(session.state));
  for (const session of active) await session.closeIfOpen();
  console.log(JSON.stringify({ stopped: active.map((session) => session.id), count: active.length }));
} finally {
  client.close();
}
