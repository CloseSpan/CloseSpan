import type { Stage } from "./domain";
import { otherProblems, primaryProblem } from "./seed";

const automationMemory = globalThis as typeof globalThis & {
  closeSpanProblemStages?: Map<string, Map<string, Stage>>;
  closeSpanLastProblemTransition?: Map<string, number>;
};

function initialStages(): Map<string, Stage> {
  return new Map([
    [primaryProblem.id, primaryProblem.stage],
    ...otherProblems.map(
      (problem) => [problem.id, problem.stage as Stage] as const,
    ),
  ]);
}

function organizations(): Map<string, Map<string, Stage>> {
  automationMemory.closeSpanProblemStages ??= new Map();
  return automationMemory.closeSpanProblemStages;
}

function lastTransitions(): Map<string, number> {
  automationMemory.closeSpanLastProblemTransition ??= new Map();
  return automationMemory.closeSpanLastProblemTransition;
}

function stagesFor(orgId: string): Map<string, Stage> {
  let stages = organizations().get(orgId);
  if (!stages) {
    stages = initialStages();
    organizations().set(orgId, stages);
  }
  return stages;
}

export function getMemoryProblemStages(orgId: string): Map<string, Stage> {
  return new Map(stagesFor(orgId));
}

export function setMemoryProblemStage(
  orgId: string,
  problemId: string,
  stage: Stage,
): void {
  stagesFor(orgId).set(problemId, stage);
}

export function memoryTransitionAvailable(
  orgId: string,
  now = Date.now(),
  cooldownMs = 30_000,
): boolean {
  const previous = lastTransitions().get(orgId);
  return previous === undefined || now - previous >= cooldownMs;
}

export function recordMemoryProblemTransition(
  orgId: string,
  now = Date.now(),
): void {
  lastTransitions().set(orgId, now);
}

export function resetMemoryProblemStages(orgId?: string): void {
  if (orgId) {
    organizations().delete(orgId);
    lastTransitions().delete(orgId);
  } else {
    automationMemory.closeSpanProblemStages = new Map();
    automationMemory.closeSpanLastProblemTransition = new Map();
  }
}
