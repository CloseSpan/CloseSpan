import { randomUUID } from "node:crypto";
import { persistenceMode, transaction } from "./db";
import { normalizeMembershipEmail } from "./organization-repository";
import { ensurePlatformUserAccessSchema, type PlatformUserStatus } from "./platform-user-access";
import { HttpError } from "./request-security";
import { isCloseSpanPlatformAdmin, isPrivateBetaOwner } from "./workspace-access-policy";

export type PlatformUserAction = "block" | "unblock" | "delete";
export interface ManagePlatformUserInput {
  actor: { email: string; role: string };
  email: string;
  action: PlatformUserAction;
  expectedStatus: "Active" | "Blocked";
  confirmationEmail?: string;
  requestId: string;
}

export async function managePlatformUser(input: ManagePlatformUserInput): Promise<{ status: PlatformUserStatus }> {
  if (!isCloseSpanPlatformAdmin(input.actor)) throw new HttpError(403, "Platform administrator permission is required.");
  const email = normalizeMembershipEmail(input.email);
  const actorEmail = normalizeMembershipEmail(input.actor.email);
  if (email === actorEmail || isPrivateBetaOwner(email)) throw new HttpError(403, "Your account and platform owner accounts are protected.");
  if (input.action === "delete" && input.confirmationEmail?.trim().toLowerCase() !== email) {
    throw new HttpError(400, "Type the user's full email address to confirm deletion.");
  }
  if (persistenceMode() !== "postgres") throw new HttpError(503, "User management requires a live database.");
  await ensurePlatformUserAccessSchema();

  return transaction(async (client) => {
    // Serialize platform account changes, including concurrent last-admin checks.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('platform-user-management', 0))");
    // Same lock as automatic account provisioning, so deletion cannot race it.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [email]);
    const previous = await client.query<{ target_email: string; action: PlatformUserAction }>(
      "SELECT target_email,action FROM platform_user_admin_events WHERE actor_email=$1 AND request_id=$2",
      [actorEmail, input.requestId],
    );
    const status: PlatformUserStatus = input.action === "block" ? "Blocked" : input.action === "unblock" ? "Active" : "Deleted";
    if (previous.rows[0]) {
      if (previous.rows[0].target_email !== email || previous.rows[0].action !== input.action) {
        throw new HttpError(409, "This request was already used for a different action.");
      }
      const latest = await client.query<{ status: PlatformUserStatus }>("SELECT status FROM platform_user_access WHERE email=$1", [email]);
      if (latest.rows[0]?.status !== status) throw new HttpError(409, "This action was already processed and the user's access has since changed. Refresh the page.");
      return { status };
    }
    const access = await client.query<{ email: string; status: PlatformUserStatus }>("SELECT email,status FROM platform_user_access FOR UPDATE");
    const statuses = new Map(access.rows.map((row) => [row.email, row.status]));
    const current = statuses.get(email) ?? "Active";
    if (current === "Deleted") throw new HttpError(404, "This account has already been deleted.");
    if (current !== input.expectedStatus) throw new HttpError(409, "This user's access changed. Refresh the page and try again.");
    if ((input.action === "block" && current !== "Active") || (input.action === "unblock" && current !== "Blocked")) {
      throw new HttpError(409, "This action does not match the user's current access.");
    }
    const members = await client.query<{ id: string; org_id: string; email: string; role: string; organization_name: string }>(
      `SELECT member.id,member.org_id,member.email,member.role,organization.name AS organization_name
         FROM workspace_members member JOIN organizations organization ON organization.id=member.org_id
         ORDER BY member.org_id,member.id FOR UPDATE OF member`,
    );
    const targetMembers = members.rows.filter((row) => normalizeMembershipEmail(row.email) === email);
    if (!targetMembers.length) throw new HttpError(404, "This user no longer has a CloseSpan account.");
    const organizationIds = [...new Set(targetMembers.map((member) => member.org_id))];

    if (input.action === "delete") {
      const withoutAdmin = targetMembers.find((target) => target.role === "Admin" && !members.rows.some((member) =>
        member.org_id === target.org_id && member.role === "Admin" &&
        normalizeMembershipEmail(member.email) !== email &&
        (statuses.get(normalizeMembershipEmail(member.email)) ?? "Active") === "Active",
      ));
      if (withoutAdmin) throw new HttpError(409, `Assign another active admin in ${withoutAdmin.organization_name} before deleting this user. You can block their access instead.`);
      for (const member of targetMembers) {
        await client.query("DELETE FROM workspace_members WHERE org_id=$1 AND id=$2", [member.org_id, member.id]);
      }
      await client.query("DELETE FROM platform_user_activity WHERE email=$1", [email]);
    }
    await client.query(
      `INSERT INTO platform_user_access(email,status) VALUES($1,$2)
       ON CONFLICT(email) DO UPDATE SET status=EXCLUDED.status,updated_at=now()`,
      [email, status],
    );
    await client.query(
      `INSERT INTO platform_user_admin_events(id,actor_email,target_email,action,previous_status,organization_ids,request_id)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [randomUUID(), actorEmail, email, input.action, current, JSON.stringify(organizationIds), input.requestId],
    );
    return { status };
  });
}
