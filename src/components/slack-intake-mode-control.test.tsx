import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SlackIntakeModeControl } from "./slack-intake-mode-control";

describe("SlackIntakeModeControl", () => {
  it("explains passive full-channel monitoring while the bot is off", () => {
    const markup = renderToStaticMarkup(
      <SlackIntakeModeControl
        orgId="org_test"
        initialStatus={{
          intakeMode: "channel",
          botInstalled: false,
          botInstallAvailable: true,
        }}
      />,
    );

    expect(markup).toContain("CloseSpan bot");
    expect(markup).toContain("Channel monitoring");
    expect(markup).toContain("listens to the full channel");
    expect(markup).toContain('role="switch"');
    expect(markup).not.toContain("checked");
  });

  it("explains the confirmation boundary in mention-only mode", () => {
    const markup = renderToStaticMarkup(
      <SlackIntakeModeControl
        orgId="org_test"
        initialStatus={{
          intakeMode: "mentions",
          botInstalled: true,
          botInstallAvailable: true,
        }}
      />,
    );

    expect(markup).toContain("Mention-only intake");
    expect(markup).toContain("every report requires confirmation");
    expect(markup).toContain("checked");
  });
});
