import type { FeedbackType } from "./domain";
import type { InvestigationVerificationStatus } from "./investigation-repository";

type InvestigationStatusTone = "success" | "warning" | "info";
type InvestigationStatusIcon = "confirmed" | "warning" | "info";

export interface InvestigationStatusCopy {
  title: string;
  detail: string;
  tone: InvestigationStatusTone;
  icon: InvestigationStatusIcon;
  showWorkingHypothesis: boolean;
}

interface InvestigationStatusCopyInput {
  feedbackType: FeedbackType | string;
  verificationStatus: InvestigationVerificationStatus;
  verificationSummary?: string | null;
  runtimeOutcome?: "Confirmed current" | "Not reproduced" | "Verification blocked" | null;
  runtimeSummary?: string | null;
  hypothesis: string;
}

type ReviewState =
  | "confirmed"
  | "not-reproduced"
  | "resolved"
  | "blocked"
  | "pending";

function reviewState(input: InvestigationStatusCopyInput): ReviewState {
  const status = input.runtimeOutcome ?? input.verificationStatus;
  if (status === "Confirmed current") return "confirmed";
  if (status === "Not reproduced") return "not-reproduced";
  if (status === "Already resolved") return "resolved";
  if (status === "Verification blocked") return "blocked";
  return "pending";
}

function recordedSummary(input: InvestigationStatusCopyInput): string | null {
  return input.runtimeSummary?.trim()
    || input.verificationSummary?.trim()
    || null;
}

function issueCopy(
  input: InvestigationStatusCopyInput,
  label: "Issue" | "Incident",
): InvestigationStatusCopy {
  const state = reviewState(input);
  const summary = recordedSummary(input);
  if (state === "confirmed") {
    return {
      title: `${label === "Issue" ? "Behavior" : "Incident"} confirmed · root cause unconfirmed`,
      detail: summary ?? "The reported behavior is confirmed in the current product.",
      tone: "success",
      icon: "confirmed",
      showWorkingHypothesis: true,
    };
  }
  if (state === "not-reproduced") {
    return {
      title: `${label} not reproduced`,
      detail: summary ?? "The reported behavior was not observed in the verified environment.",
      tone: "warning",
      icon: "warning",
      showWorkingHypothesis: true,
    };
  }
  if (state === "resolved") {
    return {
      title: `${label} appears resolved`,
      detail: summary ?? "Current evidence indicates that the reported behavior is no longer present.",
      tone: "info",
      icon: "info",
      showWorkingHypothesis: false,
    };
  }
  if (state === "blocked") {
    return {
      title: `${label} verification blocked`,
      detail: summary ?? "Resolve the recorded environment or access blocker before verifying this report again.",
      tone: "warning",
      icon: "warning",
      showWorkingHypothesis: true,
    };
  }
  return {
    title: `${label} not yet reproduced`,
    detail: input.hypothesis,
    tone: "warning",
    icon: "warning",
    showWorkingHypothesis: false,
  };
}

export function investigationStatusCopy(
  input: InvestigationStatusCopyInput,
): InvestigationStatusCopy {
  if (input.feedbackType === "Bug") return issueCopy(input, "Issue");
  if (input.feedbackType === "Incident") return issueCopy(input, "Incident");

  const state = reviewState(input);
  const summary = recordedSummary(input);

  if (input.feedbackType === "Feature request") {
    if (state === "confirmed") {
      return {
        title: "Feature need confirmed",
        detail: summary ?? "The requested outcome is confirmed and its implementation scope is ready for review.",
        tone: "success",
        icon: "confirmed",
        showWorkingHypothesis: false,
      };
    }
    if (state === "blocked") {
      return {
        title: "Feature scope review blocked",
        detail: summary ?? "Resolve the recorded blocker before confirming the requested outcome and scope.",
        tone: "warning",
        icon: "warning",
        showWorkingHypothesis: false,
      };
    }
    if (state === "resolved") {
      return {
        title: "Feature request already addressed",
        detail: summary ?? "Current evidence indicates that the requested capability is already available.",
        tone: "info",
        icon: "info",
        showWorkingHypothesis: false,
      };
    }
    if (state === "not-reproduced") {
      return {
        title: "Requested product gap not confirmed",
        detail: summary ?? "The current workflow did not confirm the reported product gap.",
        tone: "info",
        icon: "info",
        showWorkingHypothesis: false,
      };
    }
    return {
      title: "Feature scope not yet confirmed",
      detail: "Confirm the desired outcome, boundaries, and acceptance criteria before preparing implementation work.",
      tone: "warning",
      icon: "warning",
      showWorkingHypothesis: false,
    };
  }

  if (input.feedbackType === "Usability") {
    if (state === "confirmed") {
      return {
        title: "Usability impact confirmed",
        detail: summary ?? "The affected workflow and user impact have been confirmed.",
        tone: "success",
        icon: "confirmed",
        showWorkingHypothesis: false,
      };
    }
    if (state === "blocked") {
      return {
        title: "Usability review blocked",
        detail: summary ?? "Resolve the recorded blocker before validating the affected workflow.",
        tone: "warning",
        icon: "warning",
        showWorkingHypothesis: false,
      };
    }
    if (state === "resolved") {
      return {
        title: "Usability concern appears resolved",
        detail: summary ?? "Current evidence indicates that the reported friction is no longer present.",
        tone: "info",
        icon: "info",
        showWorkingHypothesis: false,
      };
    }
    if (state === "not-reproduced") {
      return {
        title: "Usability concern not reproduced",
        detail: summary ?? "The reported friction was not observed in the reviewed workflow.",
        tone: "info",
        icon: "info",
        showWorkingHypothesis: false,
      };
    }
    return {
      title: "Usability impact not yet confirmed",
      detail: "Confirm the affected workflow, user friction, and expected improvement before preparing implementation work.",
      tone: "warning",
      icon: "warning",
      showWorkingHypothesis: false,
    };
  }

  if (input.feedbackType === "Question") {
    if (state === "confirmed" || state === "resolved") {
      return {
        title: "Enquiry reviewed",
        detail: summary ?? "The user’s question has been reviewed. Reclassify it only if the response reveals a product change.",
        tone: "info",
        icon: "info",
        showWorkingHypothesis: false,
      };
    }
    if (state === "blocked") {
      return {
        title: "Enquiry review blocked",
        detail: summary ?? "Resolve the recorded blocker before responding to this enquiry.",
        tone: "warning",
        icon: "warning",
        showWorkingHypothesis: false,
      };
    }
    return {
      title: "Enquiry needs a response",
      detail: "Clarify the user’s question and provide an answer. Reclassify it only if it reveals a product issue or feature need.",
      tone: "info",
      icon: "info",
      showWorkingHypothesis: false,
    };
  }

  return {
    title: state === "confirmed" ? "Request reviewed" : "Request needs classification",
    detail: summary ?? "Confirm whether this is an issue, feature request, usability concern, or enquiry before preparing implementation work.",
    tone: state === "blocked" ? "warning" : "info",
    icon: state === "blocked" ? "warning" : "info",
    showWorkingHypothesis: false,
  };
}
