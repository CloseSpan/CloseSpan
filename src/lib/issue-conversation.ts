import { z } from "zod";

export const issueConversationMessageSchema = z.object({
  message: z.string().trim().min(1).max(2_000),
}).strict();

export interface IssueConversationProposal {
  summary: string;
  revisedPrompt: string;
  currentPromptHash: string;
  revisionReceipt: string;
  /** Original saved user message, needed by the existing revision endpoint. */
  message: string;
}

export interface IssueConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  proposal?: IssueConversationProposal;
  status?: "processing" | "completed" | "failed";
}

export interface IssueConversationView {
  messages: IssueConversationMessage[];
  storageReady: boolean;
  pending: boolean;
  notice?: string;
}

/** Always remove obvious secrets and personal contact details from provider context. */
export function sanitizeIssueConversationText(value: string, limit = 4_000): string {
  return value
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[REDACTED_SECRET]")
    .replace(/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/g, "[REDACTED_SECRET]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED_SECRET]")
    .replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED_SECRET]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .slice(0, limit);
}

/** Bound arbitrary saved JSON without sending execution logs or unbounded objects. */
export function boundedIssueConversationEvidence(value: unknown, budget = 14_000): unknown {
  let remaining = budget;
  function visit(item: unknown, depth: number): unknown {
    if (remaining <= 0) return "[truncated]";
    if (typeof item === "string") {
      const output = sanitizeIssueConversationText(item, Math.min(2_000, remaining));
      remaining -= output.length;
      return output;
    }
    if (typeof item === "number" || typeof item === "boolean" || item === null) return item;
    if (depth > 5) return "[truncated]";
    if (Array.isArray(item)) return item.slice(0, 12).map((entry) => visit(entry, depth + 1));
    if (typeof item === "object") {
      return Object.fromEntries(Object.entries(item).slice(0, 24).map(([key, entry]) => [key, visit(entry, depth + 1)]));
    }
    return null;
  }
  return visit(value, 0);
}
