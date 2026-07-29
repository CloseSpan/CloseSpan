export type UserStoryPromptTestStatus =
  | "empty"
  | "malformed"
  | "prompt-section-missing"
  | "mismatch"
  | "match";

export interface UserStoryPromptTestResult {
  matches: boolean;
  status: UserStoryPromptTestStatus;
  message: string;
  promptStory?: string;
}

function normalize(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim().replace(/\s+/g, " ");
}

function hasUserStoryStructure(value: string): boolean {
  const match =
    /^As an?\s+(.+?)\s*,?\s+I want\s+(.+?)\s*,?\s+so that\s+(.+?)\.?$/iu.exec(
      value,
    );
  return Boolean(
    match &&
      match.slice(1).every((part) => /[\p{L}\p{N}]/u.test(part)),
  );
}

export function userStoryInputIssue(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return "Write a user story before testing the prompt.";
  }
  const story = value.trim();
  if (story.length < 15 || story.length > 2_000 || !hasUserStoryStructure(story)) {
    return "Use the format: As a…, I want…, so that…";
  }
  return null;
}

function promptUserStory(promptContent: string): string | null {
  const lines = promptContent.replace(/\r\n?/g, "\n").split("\n");
  const headings: number[] = [];
  let fenced = false;
  for (const [index, line] of lines.entries()) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced && line === "## User story") headings.push(index);
  }
  if (headings.length !== 1) return null;
  const heading = headings[0];
  const storyLines: string[] = [];
  fenced = false;
  for (const line of lines.slice(heading + 1)) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (!fenced && /^##\s+/.test(line)) break;
    storyLines.push(line);
  }
  const story = storyLines.join("\n").trim();
  return story || null;
}

export function evaluateUserStoryPromptMatch(
  userStory: unknown,
  promptContent: unknown,
): UserStoryPromptTestResult {
  const issue = userStoryInputIssue(userStory);
  if (issue) {
    return {
      matches: false,
      status:
        typeof userStory !== "string" || !userStory.trim()
          ? "empty"
          : "malformed",
      message: issue,
    };
  }
  const promptStory =
    typeof promptContent === "string" ? promptUserStory(promptContent) : null;
  if (!promptStory) {
    return {
      matches: false,
      status: "prompt-section-missing",
      message: "The implementation prompt does not contain a user-story section.",
    };
  }
  if (normalize(promptStory) !== normalize(userStory as string)) {
    return {
      matches: false,
      status: "mismatch",
      message: "The prompt contains a different user story.",
      promptStory,
    };
  }
  return {
    matches: true,
    status: "match",
    message: "Story included in prompt.",
    promptStory,
  };
}
