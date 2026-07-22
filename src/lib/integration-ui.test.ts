import { describe, expect, it } from "vitest";
import {
  getIntegrationExperience,
  getIntegrationGroup,
  isSimulatedConnectedState,
} from "./integration-ui";

describe("integration UI metadata", () => {
  it("maps support tools into the Support filter", () => {
    expect(
      getIntegrationExperience({ id: "int_zendesk", provider: "Zendesk", category: "Feedback" }).filter,
    ).toBe("Support");
  });

  it("maps connector states into stable catalog groups", () => {
    expect(getIntegrationGroup({ connected: true, available: true })).toBe("Connected");
    expect(getIntegrationGroup({ connected: false, available: true })).toBe("Recommended");
    expect(getIntegrationGroup({ connected: false, available: false })).toBe("Coming soon");
  });

  it("recognizes explicit presentation-only connection states", () => {
    expect(isSimulatedConnectedState("Demo connected")).toBe(true);
    expect(isSimulatedConnectedState("Seeded sample")).toBe(true);
    expect(isSimulatedConnectedState("Connected")).toBe(false);
    expect(isSimulatedConnectedState("Not connected")).toBe(false);
  });
});
