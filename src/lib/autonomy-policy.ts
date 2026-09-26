export const autonomyLevels = [
  "Observe",
  "Recommend",
  "Execute with approval",
  "Automatic coding, human merge",
  "Full autonomy",
] as const;

export type AutonomyLevel = (typeof autonomyLevels)[number];

export interface AutonomyCapabilities {
  investigate: boolean;
  preparePrompt: boolean;
  requestAgentExecution: boolean;
  automaticallyAuthorizeExecution: boolean;
  automaticallyAuthorizeFinalExecution: boolean;
}

const capabilities: Record<AutonomyLevel, AutonomyCapabilities> = {
  Observe: {
    investigate: false,
    preparePrompt: false,
    requestAgentExecution: false,
    automaticallyAuthorizeExecution: false,
    automaticallyAuthorizeFinalExecution: false,
  },
  Recommend: {
    investigate: true,
    preparePrompt: true,
    requestAgentExecution: false,
    automaticallyAuthorizeExecution: false,
    automaticallyAuthorizeFinalExecution: false,
  },
  "Execute with approval": {
    investigate: true,
    preparePrompt: true,
    requestAgentExecution: true,
    automaticallyAuthorizeExecution: false,
    automaticallyAuthorizeFinalExecution: false,
  },
  "Automatic coding, human merge": {
    investigate: true,
    preparePrompt: true,
    requestAgentExecution: true,
    automaticallyAuthorizeExecution: true,
    automaticallyAuthorizeFinalExecution: false,
  },
  // Keep saved legacy policies readable, with the same mandatory human merge boundary.
  "Full autonomy": {
    investigate: true,
    preparePrompt: true,
    requestAgentExecution: true,
    automaticallyAuthorizeExecution: true,
    automaticallyAuthorizeFinalExecution: false,
  },
};

export function normalizeAutonomyLevel(value: unknown): AutonomyLevel {
  return autonomyLevels.includes(value as AutonomyLevel)
    ? (value as AutonomyLevel)
    : "Execute with approval";
}

export function autonomyCapabilities(level: AutonomyLevel): AutonomyCapabilities {
  return capabilities[level];
}

/** Admission check against recorded workspace usage; provider billing caps are separate. */
export function automaticCodingBudgetAllowsExecution(settings: {
  monthly_model_budget: number;
  used_model_cost: number;
  hard_stop: boolean;
} | undefined): boolean {
  return Boolean(settings
    && settings.hard_stop === true
    && Number.isFinite(settings.monthly_model_budget)
    && settings.monthly_model_budget > 0
    && Number.isFinite(settings.used_model_cost)
    && settings.used_model_cost >= 0
    && settings.used_model_cost < settings.monthly_model_budget);
}

export function autonomyDescription(level: AutonomyLevel): string {
  switch (level) {
    case "Observe":
      return "Listen, classify, and surface evidence. No investigation, prompt, or execution is started.";
    case "Recommend":
      return "Investigate and prepare prompts and Prompt Testing contracts. Code execution, merge, and deployment stay blocked.";
    case "Automatic coding, human merge":
    case "Full autonomy":
      return "Start coding automatically in approved repositories after workspace budget checks. An authorized human must approve every merge or deployment.";
    default:
      return "Require approval before the Tenki agent run and again before merge or deployment.";
  }
}
