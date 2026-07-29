export interface NotificationPayload {
  kind: "incident_opened" | "incident_updated" | "incident_resolved" | "maintenance_scheduled" | "maintenance_started";
  title: string;
  message: string;
  status: string;
  url: string;
  occurredAt: string;
}

interface OutboxRow {
  id: string;
  channel: "email" | "webhook";
  payload_json: string;
  attempts: number;
}

function safeText(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 4_000) : "";
}

function parsePayload(raw: string): NotificationPayload {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") throw new Error("Notification payload is invalid");
  const record = value as Record<string, unknown>;
  return {
    kind: safeText(record.kind) as NotificationPayload["kind"],
    title: safeText(record.title),
    message: safeText(record.message),
    status: safeText(record.status),
    url: safeText(record.url),
    occurredAt: safeText(record.occurredAt),
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  })[character]!);
}

export async function enqueueNotification(
  db: D1Database,
  eventKey: string,
  payload: NotificationPayload,
  includeWebhook: boolean,
): Promise<void> {
  const now = Date.now();
  const statements = [
    db.prepare(`INSERT OR IGNORE INTO notification_outbox
      (id,event_key,channel,payload_json,state,attempts,next_attempt_at,created_at)
      VALUES(?,?,?,?, 'pending',0,?,?)`)
      .bind(crypto.randomUUID(), eventKey, "email", JSON.stringify(payload), now, now),
  ];
  if (includeWebhook) {
    statements.push(db.prepare(`INSERT OR IGNORE INTO notification_outbox
      (id,event_key,channel,payload_json,state,attempts,next_attempt_at,created_at)
      VALUES(?,?,?,?, 'pending',0,?,?)`)
      .bind(crypto.randomUUID(), eventKey, "webhook", JSON.stringify(payload), now, now));
  }
  await db.batch(statements);
}

async function deliver(row: OutboxRow, payload: NotificationPayload, env: Env): Promise<void> {
  const subject = `[CloseSpan ${payload.status}] ${payload.title}`;
  if (row.channel === "email") {
    await env.STATUS_EMAIL.send({
      to: env.STATUS_EMAIL_TO,
      from: { email: env.STATUS_EMAIL_FROM, name: "CloseSpan Status" },
      replyTo: "support@closespan.com",
      subject,
      text: `${payload.message}\n\nStatus: ${payload.status}\n${payload.url}`,
      html: `<div style="font-family:Inter,Arial,sans-serif;color:#111827"><h2>${escapeHtml(payload.title)}</h2><p>${escapeHtml(payload.message)}</p><p><strong>Status:</strong> ${escapeHtml(payload.status)}</p><p><a href="${escapeHtml(payload.url)}">View CloseSpan status</a></p></div>`,
    });
    return;
  }

  if (!env.STATUS_WEBHOOK_URL) throw new Error("Status webhook is not configured");
  const response = await fetch(env.STATUS_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: `${subject}\n${payload.message}\n${payload.url}`,
      content: `**${subject}**\n${payload.message}\n${payload.url}`,
      event: payload,
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}`);
  if (response.body) await response.body.cancel();
}

export async function processNotificationOutbox(env: Env, now = Date.now()): Promise<void> {
  const rows = await env.DB.prepare(`SELECT id,channel,payload_json,attempts FROM notification_outbox
    WHERE state='pending' AND next_attempt_at<=? ORDER BY created_at LIMIT 20`).bind(now).all<OutboxRow>();
  for (const row of rows.results) {
    try {
      await deliver(row, parsePayload(row.payload_json), env);
      await env.DB.prepare(`UPDATE notification_outbox SET state='sent',sent_at=?,last_error=NULL WHERE id=?`)
        .bind(Date.now(), row.id).run();
    } catch (error) {
      const attempts = row.attempts + 1;
      const delays = [60_000, 300_000, 900_000, 3_600_000, 21_600_000];
      const state = attempts >= 8 ? "failed" : "pending";
      const delay = delays[Math.min(attempts - 1, delays.length - 1)]!;
      await env.DB.prepare(`UPDATE notification_outbox SET state=?,attempts=?,next_attempt_at=?,last_error=? WHERE id=?`)
        .bind(state, attempts, now + delay, error instanceof Error ? error.message.slice(0, 500) : "Delivery failed", row.id).run();
      console.error(JSON.stringify({ event: "status_notification_failed", channel: row.channel, attempts, error: error instanceof Error ? error.name : "unknown" }));
    }
  }
}
