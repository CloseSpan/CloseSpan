import { describe, expect, it } from "vitest";
import { hasExplicitMalfunctionSignal } from "./feedback-classification";

describe("feedback classification guardrails", () => {
  it.each([
    "Post Context input doesn't work at all",
    "The input does not work",
    "The control is nonfunctional",
    "Uploads stopped working yesterday",
    "The export fails to finish",
    "The dashboard is broken",
  ])("recognizes an explicit malfunction: %s", (text) => {
    expect(hasExplicitMalfunctionSignal(text)).toBe(true);
  });

  it.each([
    "How does this input work?",
    "I cannot find the setting",
    "This workflow is hard to use",
    "Please add a Post Context input",
  ])("does not over-classify ambiguous feedback: %s", (text) => {
    expect(hasExplicitMalfunctionSignal(text)).toBe(false);
  });
});
