import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  RuntimeInteractionEvidence,
  runtimeInteractionStageLabel,
} from "./runtime-interaction-evidence";

describe("runtime interaction evidence", () => {
  it("distinguishes implementation and verification VM evidence", () => {
    const implementationMarkup = renderToStaticMarkup(
      <RuntimeInteractionEvidence interaction={{
        stage: "implementation",
        tool: "browser",
        target: "/exports",
        status: "browser interaction passed",
        evidence: "Rendered exports were inspected.",
      }} />,
    );
    const verificationMarkup = renderToStaticMarkup(
      <RuntimeInteractionEvidence interaction={{
        stage: "verification",
        tool: "setup",
        target: "automatic setup",
        status: "passed",
        evidence: "Approved install and build commands passed.",
      }} />,
    );

    expect(implementationMarkup).toContain("Implementation VM");
    expect(implementationMarkup).toContain("browser");
    expect(verificationMarkup).toContain("Verification VM");
    expect(verificationMarkup).toContain("setup");
  });

  it("keeps legacy evidence readable when it has no stage", () => {
    expect(runtimeInteractionStageLabel(undefined)).toBe("Runtime");
  });
});
