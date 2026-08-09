import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

export type AccountRevenueAuthority =
  | "unknown"
  | "zendesk"
  | "webhook"
  | "crm"
  | "billing";

const revenuePriority: Record<AccountRevenueAuthority, number> = {
  unknown: 0,
  zendesk: 10,
  webhook: 40,
  crm: 80,
  billing: 100,
};

export interface ExternalCustomerAccountInput {
  orgId: string;
  integrationId: string;
  sourceNamespace: string;
  /**
   * Exact, trusted predecessor namespaces for the same upstream instance.
   * This is intentionally explicit: caller-supplied domains are not account
   * identities and must never be used to merge customer records.
   */
  sourceNamespaceAliases?: readonly string[];
  externalAccountId: string;
  name: string;
  domain?: string | null;
  tier?: string | null;
  arr?: number | null;
  sourceAuthority?: AccountRevenueAuthority;
  revenueAuthority?: AccountRevenueAuthority;
  customerSince?: number | null;
  churnRisk?: string | null;
  sourceCreatedAt?: Date | null;
  sourceUpdatedAt?: Date | null;
  metadata?: Record<string, unknown>;
}

export interface ResolvedCustomerAccount {
  accountId: string;
  created: boolean;
}

function compactText(value: string, maximum: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function optionalText(value: string | null | undefined, maximum: number) {
  if (!value) return null;
  return compactText(value, maximum) || null;
}

function validYear(value: number | null | undefined): number | null {
  const maximum = new Date().getUTCFullYear() + 1;
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1900 &&
    value <= maximum
    ? value
    : null;
}

function validRevenue(value: number | null | undefined): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 1_000_000_000
    ? value
    : null;
}

function validDate(value: Date | null | undefined): Date | null {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value : null;
}

export function customerAccountId(input: Pick<
  ExternalCustomerAccountInput,
  "orgId" | "integrationId" | "sourceNamespace" | "externalAccountId"
>): string {
  const digest = createHash("sha256")
    .update(`${input.orgId}\u0000${input.integrationId}\u0000${input.sourceNamespace}\u0000${input.externalAccountId}`)
    .digest("hex")
    .slice(0, 24);
  return `acct_${digest}`;
}

export async function resolveOrCreateExternalAccount(
  client: Pick<PoolClient, "query">,
  input: ExternalCustomerAccountInput,
): Promise<ResolvedCustomerAccount> {
  const orgId = compactText(input.orgId, 255);
  const integrationId = compactText(input.integrationId, 255);
  const sourceNamespace = compactText(input.sourceNamespace, 255);
  const externalAccountId = compactText(input.externalAccountId, 512);
  const name = compactText(input.name, 160);
  if (!orgId || !integrationId || !sourceNamespace || !externalAccountId || !name)
    throw new Error("A stable source identity and customer name are required");

  const tier = optionalText(input.tier, 32);
  const churnRisk = optionalText(input.churnRisk, 32);
  const domain = optionalText(input.domain, 255)?.toLowerCase() ?? null;
  const customerSince = validYear(input.customerSince);
  const arr = validRevenue(input.arr);
  const profileAuthority = input.sourceAuthority ?? "unknown";
  const profilePriority = revenuePriority[profileAuthority];
  const revenueAuthority = arr === null
    ? "unknown"
    : input.revenueAuthority ?? profileAuthority;
  const revenueSourcePriority = revenuePriority[revenueAuthority];
  const sourceCreatedAt = validDate(input.sourceCreatedAt);
  const observedSourceUpdatedAt = validDate(input.sourceUpdatedAt);
  if (input.sourceUpdatedAt && !observedSourceUpdatedAt) {
    throw new Error("sourceUpdatedAt must be a valid timestamp");
  }
  if (
    observedSourceUpdatedAt &&
    observedSourceUpdatedAt.getTime() > Date.now() + 5 * 60 * 1000
  ) {
    throw new Error("sourceUpdatedAt cannot be in the future");
  }
  const sourceUpdatedAt = observedSourceUpdatedAt ?? new Date();
  const accountId = customerAccountId({
    orgId,
    integrationId,
    sourceNamespace,
    externalAccountId,
  });
  const sourceNamespaceAliases = [...new Set(
    (input.sourceNamespaceAliases ?? [])
      .map((alias) => compactText(alias, 255))
      .filter((alias) => alias && alias !== sourceNamespace),
  )].slice(0, 20);
  const identityKeys = [sourceNamespace, ...sourceNamespaceAliases]
    .map((namespace) =>
      `${orgId}:${integrationId}:${namespace}:${externalAccountId}`
    )
    .sort();

  // Serialize the canonical identity and any explicitly trusted predecessor
  // identities in deterministic order. This keeps reconnect migrations safe
  // without applying a global lock or treating an unverified domain as proof
  // that two customer accounts are the same.
  for (const identityKey of identityKeys) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      identityKey,
    ]);
  }

  const existing = await client.query<{ account_id: string }>(
    `SELECT account_id FROM account_source_links
      WHERE org_id=$1 AND integration_id=$2 AND source_namespace=$3
        AND external_account_id=$4
      FOR UPDATE`,
    [orgId, integrationId, sourceNamespace, externalAccountId],
  );
  let matchedAccountId = existing.rows[0]?.account_id ?? null;
  if (!matchedAccountId && sourceNamespaceAliases.length > 0) {
    const aliasMatches = await client.query<{ account_id: string }>(
      `SELECT account_id FROM account_source_links
        WHERE org_id=$1 AND integration_id=$2
          AND source_namespace=ANY($3::text[])
          AND external_account_id=$4
        FOR UPDATE`,
      [
        orgId,
        integrationId,
        sourceNamespaceAliases,
        externalAccountId,
      ],
    );
    const accountIds = [...new Set(aliasMatches.rows.map((row) => row.account_id))];
    if (accountIds.length > 1) {
      throw new Error("Source namespace aliases resolve to multiple accounts");
    }
    matchedAccountId = accountIds[0] ?? null;
  }
  const resolvedAccountId = matchedAccountId ?? accountId;
  const sourceLinkExists = existing.rowCount !== 0;
  const created = !sourceLinkExists && !matchedAccountId;

  if (created) {
    await client.query(
      `INSERT INTO accounts(
         id,org_id,name,arr,tier,customer_since,churn_risk,origin,
         arr_source,arr_source_priority,arr_source_updated_at,
         profile_source,profile_source_priority,profile_source_updated_at,
         customer_since_known
       ) VALUES($1,$2,$3,$4,$5,$6,$7,'integration',$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (org_id,id) DO NOTHING`,
      [
        resolvedAccountId,
        orgId,
        name,
        arr ?? 0,
        tier ?? "Unknown",
        customerSince ?? new Date().getUTCFullYear(),
        churnRisk ?? "Unknown",
        revenueAuthority,
        revenueSourcePriority,
        sourceUpdatedAt,
        profileAuthority,
        profilePriority,
        sourceUpdatedAt,
        customerSince !== null,
      ],
    );
  }
  if (!sourceLinkExists) {
    await client.query(
      `INSERT INTO account_source_links(
         org_id,integration_id,source_namespace,external_account_id,account_id,
         source_name,source_domain,source_created_at,source_updated_at,metadata
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
      [
        orgId,
        integrationId,
        sourceNamespace,
        externalAccountId,
        resolvedAccountId,
        name,
        domain,
        sourceCreatedAt,
        observedSourceUpdatedAt,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }

  await client.query(
    `UPDATE accounts SET
       name=CASE
         WHEN $8::smallint > profile_source_priority OR
           ($8::smallint = profile_source_priority AND $10::timestamptz >= profile_source_updated_at)
         THEN $3 ELSE name END,
       tier=CASE
         WHEN $8::smallint > profile_source_priority OR
           ($8::smallint = profile_source_priority AND $10::timestamptz >= profile_source_updated_at)
         THEN COALESCE($4,tier) ELSE tier END,
       customer_since=CASE
         WHEN $8::smallint > profile_source_priority OR
           ($8::smallint = profile_source_priority AND $10::timestamptz >= profile_source_updated_at)
         THEN COALESCE($5,customer_since) ELSE customer_since END,
       customer_since_known=CASE
         WHEN $8::smallint > profile_source_priority OR
           ($8::smallint = profile_source_priority AND $10::timestamptz >= profile_source_updated_at)
         THEN customer_since_known OR $5::integer IS NOT NULL
         ELSE customer_since_known END,
       churn_risk=CASE
         WHEN $8::smallint > profile_source_priority OR
           ($8::smallint = profile_source_priority AND $10::timestamptz >= profile_source_updated_at)
         THEN COALESCE($6,churn_risk) ELSE churn_risk END,
       profile_source=CASE
         WHEN $8::smallint > profile_source_priority OR
           ($8::smallint = profile_source_priority AND $10::timestamptz >= profile_source_updated_at)
         THEN $9 ELSE profile_source END,
       profile_source_priority=CASE
         WHEN $8::smallint > profile_source_priority OR
           ($8::smallint = profile_source_priority AND $10::timestamptz >= profile_source_updated_at)
         THEN $8 ELSE profile_source_priority END,
       profile_source_updated_at=CASE
         WHEN $8::smallint > profile_source_priority OR
           ($8::smallint = profile_source_priority AND $10::timestamptz >= profile_source_updated_at)
         THEN $10 ELSE profile_source_updated_at END,
       arr=CASE
         WHEN $7::integer IS NOT NULL AND (
           $11::smallint > arr_source_priority OR
           ($11::smallint = arr_source_priority AND $13::timestamptz >= arr_source_updated_at)
         ) THEN $7 ELSE arr END,
       arr_source=CASE
         WHEN $7::integer IS NOT NULL AND (
           $11::smallint > arr_source_priority OR
           ($11::smallint = arr_source_priority AND $13::timestamptz >= arr_source_updated_at)
         ) THEN $12 ELSE arr_source END,
       arr_source_priority=CASE
         WHEN $7::integer IS NOT NULL AND (
           $11::smallint > arr_source_priority OR
           ($11::smallint = arr_source_priority AND $13::timestamptz >= arr_source_updated_at)
         ) THEN $11 ELSE arr_source_priority END,
       arr_source_updated_at=CASE
         WHEN $7::integer IS NOT NULL AND (
           $11::smallint > arr_source_priority OR
           ($11::smallint = arr_source_priority AND $13::timestamptz >= arr_source_updated_at)
         ) THEN $13 ELSE arr_source_updated_at END,
       updated_at=now()
     WHERE org_id=$1 AND id=$2`,
    [
      orgId,
      resolvedAccountId,
      name,
      tier,
      customerSince,
      churnRisk,
      arr,
      profilePriority,
      profileAuthority,
      sourceUpdatedAt,
      revenueSourcePriority,
      revenueAuthority,
      sourceUpdatedAt,
    ],
  );
  await client.query(
    `UPDATE account_source_links SET
       source_name=CASE
         WHEN $8::timestamptz IS NULL OR source_updated_at IS NULL OR $8 >= source_updated_at
         THEN $5 ELSE source_name END,
       source_domain=CASE
         WHEN $8::timestamptz IS NULL OR source_updated_at IS NULL OR $8 >= source_updated_at
         THEN COALESCE($6,source_domain) ELSE source_domain END,
       source_created_at=CASE
         WHEN $8::timestamptz IS NULL OR source_updated_at IS NULL OR $8 >= source_updated_at
         THEN COALESCE($7,source_created_at) ELSE source_created_at END,
       source_updated_at=CASE
         WHEN $8::timestamptz IS NULL OR source_updated_at IS NULL OR $8 >= source_updated_at
         THEN COALESCE($8,source_updated_at) ELSE source_updated_at END,
       metadata=CASE
         WHEN $8::timestamptz IS NULL OR source_updated_at IS NULL OR $8 >= source_updated_at
         THEN metadata || $9::jsonb ELSE metadata END,
       last_seen_at=now()
     WHERE org_id=$1 AND integration_id=$2 AND source_namespace=$3
       AND external_account_id=$4`,
    [
      orgId,
      integrationId,
      sourceNamespace,
      externalAccountId,
      name,
      domain,
      sourceCreatedAt,
      observedSourceUpdatedAt,
      JSON.stringify(input.metadata ?? {}),
    ],
  );

  return { accountId: resolvedAccountId, created };
}
