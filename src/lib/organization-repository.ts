import { randomUUID } from "node:crypto";
import { databasePool, persistenceMode, transaction } from "./db";
import { integrationCatalog } from "./integration-catalog";
import { workspacePersistenceMode } from "./workspace-persistence";

export interface OrganizationMembership {
  memberId: string;
  organizationId: string;
  organizationName: string;
  displayName: string;
  email: string;
  role: string;
}

export interface CreateOrganizationInput {
  name: string;
  productName?: string | null;
  productUrl?: string | null;
  productDescription?: string | null;
  creator: {
    name: string;
    email: string;
  };
}

export interface CreatedOrganization {
  organizationId: string;
  organizationName: string;
  workspaceId: string;
  memberId: string;
}

export interface RenameOrganizationInput {
  orgId: string;
  name: string;
  actor: {
    actorId: string;
    actorName: string;
    traceId: string;
  };
}

export interface RenamedOrganization {
  organizationId: string;
  organizationName: string;
}

export interface DeleteOrganizationInput {
  orgId: string;
  actorMemberId: string;
}

const defaultPriorityWeights = {
  frequency: 20,
  severity: 20,
  revenue: 20,
  churnRisk: 15,
  customerTier: 10,
  strategicAlignment: 5,
  sla: 5,
  engineeringEffort: 5,
};

const membershipLookupSql = `SELECT m.id AS member_id, m.org_id,
       o.name AS organization_name, m.display_name, m.email, m.role
  FROM workspace_members m
  JOIN organizations o ON o.id=m.org_id
 WHERE CASE
         WHEN lower(split_part(btrim(m.email), '@', 2))
              IN ('gmail.com','googlemail.com')
           THEN replace(
             lower(split_part(split_part(btrim(m.email), '@', 1), '+', 1)),
             '.', ''
           )
         ELSE lower(split_part(btrim(m.email), '@', 1))
       END
       || '@'
       || CASE
            WHEN lower(split_part(btrim(m.email), '@', 2))='googlemail.com'
              THEN 'gmail.com'
            ELSE lower(split_part(btrim(m.email), '@', 2))
          END
       = $1
 ORDER BY lower(o.name), o.id, m.id`;

export function normalizeMembershipEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const [localPart, domainPart] = trimmed.split("@");
  if (!localPart || !domainPart) return trimmed;
  const domain = domainPart === "googlemail.com" ? "gmail.com" : domainPart;
  if (domain === "gmail.com") {
    const local = localPart.split("+")[0]?.replace(/\./g, "") ?? localPart;
    return `${local}@${domain}`;
  }
  return `${localPart}@${domain}`;
}

function mapMembership(row: {
  member_id: string;
  org_id: string;
  organization_name: string;
  display_name: string;
  email: string;
  role: string;
}): OrganizationMembership {
  return {
    memberId: row.member_id,
    organizationId: row.org_id,
    organizationName: row.organization_name,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
  };
}

/** The email must already be normalized by the trusted identity layer. */
export async function listOrganizationMemberships(
  normalizedEmail: string,
): Promise<OrganizationMembership[]> {
  if (persistenceMode() !== "postgres") return [];
  const result = await databasePool().query<{
    member_id: string;
    org_id: string;
    organization_name: string;
    display_name: string;
    email: string;
    role: string;
  }>(membershipLookupSql, [normalizedEmail]);
  return result.rows.map(mapMembership);
}

export async function findOrganizationMembership(
  normalizedEmail: string,
  organizationId: string,
): Promise<OrganizationMembership | null> {
  const memberships = await listOrganizationMemberships(normalizedEmail);
  return (
    memberships.find(
      (membership) => membership.organizationId === organizationId,
    ) ?? null
  );
}

export function selectOrganizationMembership(
  memberships: readonly OrganizationMembership[],
  requestedOrganizationId?: string | null,
): OrganizationMembership | null {
  if (memberships.length === 0) return null;
  if (requestedOrganizationId) {
    const requested = memberships.find(
      (membership) =>
        membership.organizationId === requestedOrganizationId,
    );
    if (requested) return requested;
  }
  return memberships[0] ?? null;
}

function requiredTrimmed(value: string, field: string, maxLength: number): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required`);
  if (trimmed.length > maxLength)
    throw new Error(`${field} must be ${maxLength} characters or fewer`);
  return trimmed;
}

function optionalTrimmed(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  if (trimmed.length > maxLength)
    throw new Error(`Organization details must be ${maxLength} characters or fewer`);
  return trimmed;
}

export async function createOrganization(
  input: CreateOrganizationInput,
): Promise<CreatedOrganization> {
  if (persistenceMode() !== "postgres")
    throw new Error("PostgreSQL persistence is required to create organizations");

  const organizationName = requiredTrimmed(input.name, "Organization name", 120);
  const creatorName = requiredTrimmed(input.creator.name, "Creator name", 160);
  const creatorEmail = requiredTrimmed(input.creator.email, "Creator email", 320)
    .toLowerCase();
  const productName =
    optionalTrimmed(input.productName, 160) ?? organizationName;
  const productUrl = optionalTrimmed(input.productUrl, 500);
  const productDescription = optionalTrimmed(input.productDescription, 2_000);
  const organizationId = `org_${randomUUID().replaceAll("-", "")}`;
  const workspaceId = `ws_${randomUUID().replaceAll("-", "")}`;
  const memberId = `user_${randomUUID().replaceAll("-", "")}`;

  await transaction(async (client) => {
    await client.query(
      "INSERT INTO organizations(id,name) VALUES($1,$2)",
      [organizationId, organizationName],
    );
    await client.query(
      `INSERT INTO workspaces(
         id,org_id,name,primary_problem_id,primary_approval_id,version
       ) VALUES($1,$2,$3,NULL,NULL,1)`,
      [workspaceId, organizationId, organizationName],
    );
    await client.query(
      `INSERT INTO workspace_settings(
         org_id,autonomy_level,pii_redaction,retention_days,priority_weights,
         monthly_model_budget,used_model_cost,hard_stop,plan_name,plan_price
       ) VALUES($1,'Observe',true,365,$2::jsonb,0,0,true,'Production','Managed externally')`,
      [organizationId, JSON.stringify(defaultPriorityWeights)],
    );
    await client.query(
      `INSERT INTO workspace_members(
         id,org_id,display_name,email,role,team
       ) VALUES($1,$2,$3,$4,'Admin','Owners')`,
      [memberId, organizationId, creatorName, creatorEmail],
    );
    await client.query(
      `INSERT INTO workspace_onboarding(
         org_id,phase,product_profile,recommended_connectors,messages
       ) VALUES($1,'discover',$2::jsonb,'[]'::jsonb,'[]'::jsonb)`,
      [
        organizationId,
        JSON.stringify({
          productName,
          productUrl,
          productDescription,
          companyLogo: null,
          companyProfileConfirmed: false,
          companyProfileReadyForConfirmation: false,
          feedbackSources: [],
          engineeringTools: [],
        }),
      ],
    );
    for (const integration of integrationCatalog) {
      await client.query(
        `INSERT INTO integrations(
           id,org_id,provider,category,connection_state,data_scope,
           permissions,display_order
         ) VALUES($1,$2,$3,$4,'Not connected','None','[]'::jsonb,$5)`,
        [
          integration.id,
          organizationId,
          integration.provider,
          integration.category,
          integration.displayOrder,
        ],
      );
    }
    await client.query(
      `INSERT INTO audit_events(
         id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
       ) VALUES($1,$2,$3,$4,'Created organization','Organization',$2,$5)`,
      [
        randomUUID(),
        organizationId,
        memberId,
        creatorName,
        `organization_created_${randomUUID()}`,
      ],
    );
  });

  return { organizationId, organizationName, workspaceId, memberId };
}

export async function renameOrganization(
  input: RenameOrganizationInput,
): Promise<RenamedOrganization> {
  if (workspacePersistenceMode(input.orgId) !== "postgres")
    throw new Error("PostgreSQL persistence is required to rename organizations");

  const organizationName = requiredTrimmed(
    input.name,
    "Organization name",
    120,
  );

  await transaction(async (client) => {
    const organization = await client.query(
      `UPDATE organizations
          SET name=$2,updated_at=now()
        WHERE id=$1
        RETURNING id`,
      [input.orgId, organizationName],
    );
    if (!organization.rowCount)
      throw new Error("Organization was not found");

    const workspace = await client.query(
      `UPDATE workspaces
          SET name=$2,version=version+1,updated_at=now()
        WHERE org_id=$1`,
      [input.orgId, organizationName],
    );
    if (!workspace.rowCount)
      throw new Error("Workspace was not found");
    await client.query(
      `INSERT INTO audit_events(
         id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id
       ) VALUES($1,$2,$3,$4,$5,'Organization',$2,$6)`,
      [
        randomUUID(),
        input.orgId,
        input.actor.actorId,
        input.actor.actorName,
        `Renamed workspace to ${organizationName}`,
        `${input.actor.traceId}_organization_renamed_${randomUUID()}`,
      ],
    );
  });

  return {
    organizationId: input.orgId,
    organizationName,
  };
}

export async function deleteOrganization(
  input: DeleteOrganizationInput,
): Promise<void> {
  if (workspacePersistenceMode(input.orgId) !== "postgres")
    throw new Error("PostgreSQL persistence is required to delete organizations");

  const result = await databasePool().query(
    `DELETE FROM organizations AS organization
      WHERE organization.id=$1
        AND EXISTS (
          SELECT 1
            FROM workspace_members AS member
           WHERE member.org_id=organization.id
             AND member.id=$2
             AND member.role='Admin'
        )
      RETURNING organization.id`,
    [input.orgId, input.actorMemberId],
  );

  if (!result.rowCount)
    throw new Error("Organization was not found or administrator access was revoked");
}
