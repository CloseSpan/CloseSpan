import { redactUntrustedText } from "./redaction";

export const PROBLEM_SUBJECT_INSTRUCTIONS = `Give every analysis a problemSubject: a specific 4–8-word subject naming the affected feature and the actual symptom or requested capability. Use sentence case. Omit customer names, report narration, justification, and introductory phrases such as "Customer requests". Never invent a root cause or claim a fix. Example: "Missing three-dot menu actions". Keep the full meaning and context in redactedSummary and evidence. A shared subject is not evidence that reports describe the same problem; propose an existing problem ID only when the underlying issue matches.`;

export function normalizeProblemSubject(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const subject = redactUntrustedText(value).replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  const words = subject.split(/\s+/).length;
  if (!subject || subject.length > 100 || words < 4 || words > 8 || /[\n\r<>]|…/.test(subject)) return null;
  return subject;
}

/** Legacy fallback only; new analyses provide a semantic subject, not a clipped sentence. */
export function feedbackProblemTitle(summary: string, subject?: string | null): string {
  const normalized = normalizeProblemSubject(subject);
  if (normalized) return normalized;
  const compact = summary.replace(/\s+/g, " ").trim();
  const firstSentence = compact.match(/^.*?(?:[.!?](?:\s|$)|$)/)?.[0] ?? compact;
  const title = firstSentence.trim().replace(/[.!?]+$/, "").trim();
  if (!title) return "Feedback needs product review";
  return title.length <= 100 ? title : `${title.slice(0, 97).trimEnd()}…`;
}
