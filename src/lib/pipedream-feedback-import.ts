import { createHash } from "node:crypto";
import { transaction } from "./db";
import { getPipedreamClient, pipedreamExternalUserId } from "./pipedream";
import type { PipedreamConnectorId } from "./pipedream-connectors";
import { redactUntrustedText } from "./redaction";
import {
  getPipedreamConnection,
  claimPipedreamImport,
  listPipedreamConnections,
  updatePipedreamImportCursor,
  updatePipedreamImportState,
} from "./pipedream-repository";
import { workspacePersistenceMode } from "./workspace-persistence";
import { resolveOrCreateExternalAccount } from "./customer-account-repository";

const SUPPORTED_MANUAL_IMPORTS = new Set<PipedreamConnectorId>(["int_zendesk"]);
const MAX_PAGES = 5;
const ZENDESK_PAGE_SIZE = "100";
const ZENDESK_INITIAL_START_TIME = "1";

type FeedbackType = "Bug" | "Feature request" | "Usability" | "Question" | "Incident";
type FeedbackSeverity = "Critical" | "High" | "Medium" | "Low";

interface NormalizedFeedback {
  externalId: string;
  quote: string;
  customer: string;
  type: FeedbackType;
  severity: FeedbackSeverity;
  redacted: boolean;
  environment: string;
  observedAt: string;
  account: ZendeskCustomerAccount | null;
}

interface ZendeskCustomerAccount {
  externalId: string;
  name: string;
  domain: string | null;
  tier: string | null;
  customerSince: number | null;
  sourceCreatedAt: Date | null;
  sourceUpdatedAt: Date | null;
  sourceInstance?: string | null;
  metadata: Record<string, unknown>;
}

interface ZendeskFetchResult {
  records: unknown[];
  organizations: Map<string, ZendeskCustomerAccount>;
  sourceInstance: string | null;
  continuationCursor: string;
}

export interface ManualImportResult {
  integrationId: PipedreamConnectorId;
  accountId: string;
  accountName: string | null;
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanText(value: unknown, max = 10_000): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, max) : null;
}

const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function strictIsoDate(value: unknown): Date | null {
  const text = cleanText(value, 160);
  if (!text || !ISO_TIMESTAMP.test(text)) return null;
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function zendeskSourceInstance(value: unknown): string | null {
  const url = cleanText(value, 2_000);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    return hostname && hostname.length <= 253 ? hostname : null;
  } catch {
    return null;
  }
}

function zendeskType(ticket: Record<string, unknown>, quote: string): FeedbackType {
  const text = `${cleanText(ticket.type, 80) ?? ""} ${quote}`.toLowerCase();
  if (/\b(outage|incident|unavailable|downtime)\b/.test(text)) return "Incident";
  if (/\b(feature|enhancement|request|wish|idea)\b/.test(text)) return "Feature request";
  if (/\b(confus|difficult|hard to use|usability|ux)\b/.test(text)) return "Usability";
  if (/\b(bug|error|broken|crash|fail(?:s|ed|ing)?|incorrect)\b/.test(text)) return "Bug";
  return "Question";
}

function zendeskSeverity(ticket: Record<string, unknown>, quote: string): FeedbackSeverity {
  const text = `${cleanText(ticket.priority, 40) ?? ""} ${quote}`.toLowerCase();
  if (/\b(urgent|critical|blocker|p0)\b/.test(text)) return "Critical";
  if (/\b(high|major|p1)\b/.test(text)) return "High";
  if (/\b(low|minor|p3|p4)\b/.test(text)) return "Low";
  return "Medium";
}

function zendeskOrganization(value: unknown): ZendeskCustomerAccount | null {
  const organization = object(value);
  if (!organization) return null;
  const externalId = cleanText(organization.id, 120);
  const name = cleanText(organization.name, 160);
  if (!externalId || !name) return null;
  const domains = Array.isArray(organization.domain_names)
    ? organization.domain_names
        .map((domain) => cleanText(domain, 255)?.toLowerCase())
        .filter((domain): domain is string => Boolean(domain))
    : [];
  const tags = Array.isArray(organization.tags)
    ? organization.tags
        .map((tag) => cleanText(tag, 80)?.toLowerCase())
        .filter((tag): tag is string => Boolean(tag))
        .slice(0, 40)
    : [];
  const tier = tags.includes("enterprise")
    ? "Enterprise"
    : tags.includes("growth")
      ? "Growth"
      : tags.includes("starter")
        ? "Starter"
        : null;
  const sourceCreatedAt = strictIsoDate(organization.created_at);
  const sourceUpdatedAt = strictIsoDate(organization.updated_at);
  const sourceInstance = zendeskSourceInstance(organization.url);
  return {
    externalId,
    name,
    domain: domains[0] ?? null,
    tier,
    customerSince: sourceCreatedAt?.getUTCFullYear() ?? null,
    sourceCreatedAt,
    sourceUpdatedAt,
    sourceInstance,
    metadata: {
      domains,
      tags,
      externalId: cleanText(organization.external_id, 512),
      sourceInstance,
    },
  };
}

export function normalizeZendeskTicket(
  value: unknown,
  organizations: ReadonlyMap<string, ZendeskCustomerAccount> = new Map(),
): NormalizedFeedback | null {
  const ticket = object(value);
  if (!ticket) return null;
  const externalId = cleanText(ticket.id, 512);
  const quote = cleanText(ticket.description) ?? cleanText(ticket.subject);
  if (!externalId || !quote) return null;
  const safeQuote = redactUntrustedText(quote);
  const requester = cleanText(ticket.requester_id, 120);
  const organization = cleanText(ticket.organization_id, 120);
  const account = organization ? organizations.get(organization) ?? null : null;
  const observedAt = strictIsoDate(ticket.created_at);
  const tags = Array.isArray(ticket.tags)
    ? ticket.tags.map((tag) => cleanText(tag, 80)).filter(Boolean).slice(0, 8).join(", ")
    : "";
  return {
    externalId,
    quote: safeQuote,
    customer: account?.name ?? (organization
      ? `Zendesk organization #${organization}`
      : requester ? `Zendesk requester #${requester}` : "Zendesk customer"),
    type: zendeskType(ticket, quote),
    severity: zendeskSeverity(ticket, quote),
    redacted: safeQuote !== quote,
    environment: tags || "Zendesk support",
    observedAt: observedAt?.toISOString() ?? new Date().toISOString(),
    account,
  };
}

function ticketOrganizationIds(records: unknown[]): string[] {
  return [...new Set(records
    .map((value) => object(value))
    .map((ticket) => cleanText(ticket?.organization_id, 120))
    .filter((id): id is string => Boolean(id)))];
}

async function fetchZendeskTickets(
  accountId: string,
  orgId: string,
  importCursor: string | null,
): Promise<ZendeskFetchResult> {
  const client = getPipedreamClient();
  const externalUserId = pipedreamExternalUserId(orgId);
  const accounts = await client.accounts.listByExternalUser(externalUserId, { app: "zendesk" });
  const account = accounts.find((candidate) => String(candidate.id) === accountId);
  if (!account || account.app?.nameSlug !== "zendesk") throw new Error("connection_not_available");
  if (account.dead || account.healthy === false) throw new Error("connection_not_available");
  const records: unknown[] = [];
  let cursor = cleanText(importCursor, 8_192);
  let continuationCursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await client.proxy.get({
      externalUserId,
      accountId,
      url: "/api/v2/incremental/tickets/cursor.json",
      params: cursor
        ? { cursor, per_page: ZENDESK_PAGE_SIZE }
        : {
            start_time: ZENDESK_INITIAL_START_TIME,
            per_page: ZENDESK_PAGE_SIZE,
          },
      headers: { Accept: "application/json" },
    }, { timeoutInSeconds: 30 });
    const body = object(response);
    if (!body) throw new Error("zendesk_response_invalid");
    const results = Array.isArray(body.tickets) ? body.tickets : [];
    records.push(...results);
    const afterCursor = cleanText(body.after_cursor, 8_192);
    if (!afterCursor || typeof body.end_of_stream !== "boolean") {
      throw new Error("zendesk_cursor_response_invalid");
    }
    continuationCursor = afterCursor;
    cursor = afterCursor;
    if (body.end_of_stream) break;
  }
  if (!continuationCursor) throw new Error("zendesk_cursor_response_invalid");
  const organizations = new Map<string, ZendeskCustomerAccount>();
  const organizationIds = ticketOrganizationIds(records);
  for (let offset = 0; offset < organizationIds.length; offset += 100) {
    const ids = organizationIds.slice(offset, offset + 100);
    const response = await client.proxy.get({
      externalUserId,
      accountId,
      url: "/api/v2/organizations/show_many.json",
      params: { ids: ids.join(",") },
      headers: { Accept: "application/json" },
    }, { timeoutInSeconds: 30 });
    const body = object(response);
    if (!body || !Array.isArray(body.organizations))
      throw new Error("zendesk_organizations_response_invalid");
    for (const value of body.organizations) {
      const organization = zendeskOrganization(value);
      if (organization) organizations.set(organization.externalId, organization);
    }
  }
  const sourceInstances = new Set<string>();
  for (const organization of organizations.values()) {
    if (organization.sourceInstance) sourceInstances.add(organization.sourceInstance);
  }
  for (const value of records) {
    const sourceInstance = zendeskSourceInstance(object(value)?.url);
    if (sourceInstance) sourceInstances.add(sourceInstance);
  }
  if (sourceInstances.size > 1) {
    throw new Error("zendesk_source_instance_ambiguous");
  }
  const sourceInstance = [...sourceInstances][0] ?? null;
  if (!sourceInstance && records.length > 0) {
    throw new Error("zendesk_source_instance_missing");
  }
  return { records, organizations, sourceInstance, continuationCursor };
}

async function persistZendeskTickets(input: {
  orgId: string;
  accountId: string;
  records: unknown[];
  organizations: ReadonlyMap<string, ZendeskCustomerAccount>;
  sourceInstance: string | null;
  continuationCursor: string;
  leaseToken: string;
}): Promise<Omit<ManualImportResult, "integrationId" | "accountId" | "accountName">> {
  const normalized = input.records
    .map((record) => normalizeZendeskTicket(record, input.organizations))
    .filter((item): item is NormalizedFeedback => item !== null);
  if (workspacePersistenceMode(input.orgId) !== "postgres") {
    await updatePipedreamImportCursor(null, {
      orgId: input.orgId,
      integrationId: "int_zendesk",
      accountId: input.accountId,
      cursor: input.continuationCursor,
      leaseToken: input.leaseToken,
    });
    return { fetched: input.records.length, created: normalized.length, updated: 0, skipped: input.records.length - normalized.length };
  }
  if (normalized.length === 0) {
    return transaction(async (client) => {
      await client.query(
        `UPDATE integrations SET last_sync_at=now(),error_message=NULL
          WHERE org_id=$1 AND id='int_zendesk'`,
        [input.orgId],
      );
      await updatePipedreamImportCursor(client, {
        orgId: input.orgId,
        integrationId: "int_zendesk",
        accountId: input.accountId,
        cursor: input.continuationCursor,
        leaseToken: input.leaseToken,
      });
      return {
        fetched: input.records.length,
        created: 0,
        updated: 0,
        skipped: input.records.length,
      };
    });
  }
  if (!input.sourceInstance) {
    throw new Error("zendesk_source_instance_missing");
  }
  const legacyNamespace = `pipedream:${input.accountId}:zendesk:tickets`.slice(0, 255);
  const legacyAccountNamespace = `pipedream:${input.accountId}:zendesk:organizations`.slice(0, 255);
  const namespace = `zendesk:${input.sourceInstance}:tickets`.slice(0, 255);
  const accountNamespace =
    `zendesk:${input.sourceInstance}:organizations`.slice(0, 255);
  return transaction(async (client) => {
    if (namespace !== legacyNamespace) {
      await client.query(
        `UPDATE feedback_items legacy SET source_namespace=$3
          WHERE legacy.org_id=$1 AND legacy.integration_id='int_zendesk'
            AND legacy.source_namespace=$2
            AND NOT EXISTS (
              SELECT 1 FROM feedback_items canonical
               WHERE canonical.org_id=legacy.org_id
                 AND canonical.integration_id=legacy.integration_id
                 AND canonical.source_namespace=$3
                 AND canonical.external_id=legacy.external_id
            )`,
        [input.orgId, legacyNamespace, namespace],
      );
    }
    const existing = await client.query<{ external_id: string }>(
      `SELECT external_id FROM feedback_items
        WHERE org_id=$1 AND integration_id='int_zendesk'
          AND source_namespace=$2 AND external_id=ANY($3::text[])`,
      [input.orgId, namespace, normalized.map((item) => item.externalId)],
    );
    const existingIds = new Set(existing.rows.map((row) => row.external_id));
    const accountIds = new Map<string, string>();
    for (const item of normalized) {
      const id = `fb_pd_${createHash("sha256").update(`${namespace}:${item.externalId}`).digest("hex").slice(0, 24)}`;
      let linkedAccountId: string | null = null;
      if (item.account) {
        linkedAccountId = accountIds.get(item.account.externalId) ?? null;
        if (!linkedAccountId) {
          const resolved = await resolveOrCreateExternalAccount(client, {
            orgId: input.orgId,
            integrationId: "int_zendesk",
            sourceNamespace: accountNamespace,
            sourceNamespaceAliases: accountNamespace === legacyAccountNamespace
              ? undefined
              : [legacyAccountNamespace],
            externalAccountId: item.account.externalId,
            name: item.account.name,
            domain: item.account.domain,
            tier: item.account.tier,
            customerSince: item.account.customerSince,
            sourceCreatedAt: item.account.sourceCreatedAt,
            sourceUpdatedAt: item.account.sourceUpdatedAt,
            metadata: item.account.metadata,
            sourceAuthority: "zendesk",
          });
          linkedAccountId = resolved.accountId;
          accountIds.set(item.account.externalId, linkedAccountId);
        }
      }
      await client.query(
        `INSERT INTO feedback_items(
           id,org_id,source,customer_name,account_tier,arr,type,severity,
           redacted,environment,confidence,observed_at,quote,integration_id,
           source_namespace,external_id,account_id
         ) VALUES($1,$2,'Zendesk',$3,$4,0,$5,$6,$7,$8,0.78,$9,$10,
                  'int_zendesk',$11,$12,$13)
         ON CONFLICT(org_id,integration_id,source_namespace,external_id)
           WHERE external_id IS NOT NULL
         DO UPDATE SET customer_name=excluded.customer_name,
           account_tier=excluded.account_tier,type=excluded.type,
           severity=excluded.severity,redacted=excluded.redacted,
           environment=excluded.environment,
           confidence=excluded.confidence,observed_at=excluded.observed_at,
           quote=excluded.quote,account_id=excluded.account_id,updated_at=now()`,
        [id,input.orgId,item.customer,item.account?.tier ?? "Unknown",item.type,item.severity,item.redacted,item.environment,item.observedAt,item.quote,namespace,item.externalId,linkedAccountId],
      );
    }
    await client.query(
      `UPDATE integrations SET last_sync_at=now(),error_message=NULL
        WHERE org_id=$1 AND id='int_zendesk'`,
      [input.orgId],
    );
    await updatePipedreamImportCursor(client, {
      orgId: input.orgId,
      integrationId: "int_zendesk",
      accountId: input.accountId,
      cursor: input.continuationCursor,
      leaseToken: input.leaseToken,
    });
    const updated = normalized.filter((item) => existingIds.has(item.externalId)).length;
    return {
      fetched: input.records.length,
      created: normalized.length - updated,
      updated,
      skipped: input.records.length - normalized.length,
    };
  });
}

export function supportsManualFeedbackImport(integrationId: PipedreamConnectorId): boolean {
  return SUPPORTED_MANUAL_IMPORTS.has(integrationId);
}

export async function pullPipedreamFeedback(input: {
  orgId: string;
  integrationId: PipedreamConnectorId;
  accountId: string;
}): Promise<ManualImportResult> {
  const connection = await getPipedreamConnection(input.orgId, input.integrationId, input.accountId);
  if (!connection || connection.state !== "Connected") throw new Error("connection_not_available");
  if (!supportsManualFeedbackImport(input.integrationId)) throw new Error("manual_import_not_supported");
  const claim = await claimPipedreamImport(input);
  if (!claim) throw new Error("import_in_progress");
  try {
    const fetched = await fetchZendeskTickets(
      input.accountId,
      input.orgId,
      claim.importCursor,
    );
    const counts = await persistZendeskTickets({
      orgId: input.orgId,
      accountId: input.accountId,
      records: fetched.records,
      organizations: fetched.organizations,
      sourceInstance: fetched.sourceInstance,
      continuationCursor: fetched.continuationCursor,
      leaseToken: claim.leaseToken,
    });
    await updatePipedreamImportState({
      ...input,
      status: "Succeeded",
      leaseToken: claim.leaseToken,
      count: counts.created + counts.updated,
      safeError: null,
    });
    return { ...input, accountName: connection.accountName, ...counts };
  } catch (error) {
    await updatePipedreamImportState({
      ...input,
      status: "Failed",
      leaseToken: claim.leaseToken,
      safeError: "Feedback could not be pulled. Retry shortly or reconnect this account.",
    });
    throw error;
  }
}

export async function pullAllPipedreamFeedback(orgId: string): Promise<{
  results: ManualImportResult[];
  failed: number;
  unsupported: number;
}> {
  const connections = (await listPipedreamConnections(orgId))
    .filter((connection) => connection.state === "Connected");
  const supported = connections.filter((connection) => supportsManualFeedbackImport(connection.integrationId));
  const results: ManualImportResult[] = [];
  let failed = 0;
  for (const connection of supported) {
    try {
      results.push(await pullPipedreamFeedback({ orgId, integrationId: connection.integrationId, accountId: connection.accountId }));
    } catch {
      failed += 1;
    }
  }
  return { results, failed, unsupported: connections.length - supported.length };
}
