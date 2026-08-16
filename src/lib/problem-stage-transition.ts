import type { Stage } from "./domain";

export const PRODUCT_PROBLEM_STAGES = [
  "Detected",
  "Needs review",
  "Approved",
  "Planned",
  "In progress",
  "Release Ready",
  "Released",
  "Verified",
  "Closed",
] as const satisfies readonly Stage[];

export function isProductProblemStage(value: unknown): value is Stage {
  return (
    typeof value === "string" &&
    (PRODUCT_PROBLEM_STAGES as readonly string[]).includes(value)
  );
}

const transitionCopy: Record<
  Stage,
  { title: string; summary: string; effects: string[]; caution?: string }
> = {
  Detected: {
    title: "Return to detected",
    summary: "Place this problem back in intake for renewed triage.",
    effects: ["Update the lifecycle stage", "Record the manual decision in the audit trail"],
  },
  "Needs review": {
    title: "Request another review",
    summary: "Move this problem back to evidence and scope review.",
    effects: ["Update the lifecycle stage", "Record the manual decision in the audit trail"],
  },
  Approved: {
    title: "Approve the problem",
    summary: "Record the product decision to proceed with this problem.",
    effects: ["Update the lifecycle stage", "Record the manual approval in the audit trail"],
    caution: "This does not authorize or start a coding run.",
  },
  Planned: {
    title: "Move into planned work",
    summary: "Record this problem as planned for implementation.",
    effects: ["Update the lifecycle stage", "Record the manual decision in the audit trail"],
    caution: "This does not create an external work item.",
  },
  "In progress": {
    title: "Mark implementation in progress",
    summary: "Record that implementation work is underway.",
    effects: ["Update the lifecycle stage", "Record the manual decision in the audit trail"],
    caution: "This does not launch an agent or coding run.",
  },
  "Release Ready": {
    title: "Mark release ready",
    summary: "Record that the approved change is ready for the release process.",
    effects: ["Update the lifecycle stage", "Record the manual authorization in the audit trail"],
    caution: "This does not merge a pull request or create merge evidence.",
  },
  Released: {
    title: "Mark released",
    summary: "Record the human-authorized release status for this problem.",
    effects: ["Update the lifecycle stage", "Record the manual authorization in the audit trail"],
    caution: "This does not deploy code or create a release artifact.",
  },
  Verified: {
    title: "Mark verified",
    summary: "Record a human verification decision and prepare follow-up drafts.",
    effects: [
      "Update the lifecycle stage",
      "Prepare customer follow-up drafts where linked customers exist",
      "Record the manual verification in the audit trail",
    ],
    caution: "This does not send messages or invent automated verification evidence.",
  },
  Closed: {
    title: "Close the problem",
    summary: "Record that no further lifecycle work is required.",
    effects: ["Update the lifecycle stage", "Record the manual closure in the audit trail"],
    caution: "This does not send customer messages.",
  },
};

export function problemStageTransitionPreview(toStage: Stage) {
  return transitionCopy[toStage];
}
