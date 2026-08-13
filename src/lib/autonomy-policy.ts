export const autonomyLevels = [
  "Observe",
  "Recommend",
  "Execute with approval",
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
  "Full autonomy": {
    investigate: true,
    preparePrompt: true,
    requestAgentExecution: true,
    automaticallyAuthorizeExecution: true,
    automaticallyAuthorizeFinalExecution: true,
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

export function autonomyDescription(level: AutonomyLevel): string {
  switch (level) {
    case "Observe":
      return "Listen, classify, and surface evidence. No investigation, prompt, or execution is started.";
    case "Recommend":
      return "Investigate and prepare prompts and PDD contracts. Code execution, merge, and deployment stay blocked.";
    case "Full autonomy":
      return "Run the configured workflow end to end: investigate, prepare, execute in Tenki, merge or deploy, and verify the release.";
    default:
      return "Require approval before the Tenki agent run and again before merge or deployment.";
  }
}
