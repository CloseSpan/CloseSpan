import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CustomSelect } from "./custom-select";

describe("shared dropdown selection", () => {
  it.each(["Slack", "Discord", "All sources"])("only renders a check for %s", (value) => {
    const markup = renderToStaticMarkup(
      <CustomSelect ariaLabel="Source" options={["Slack", "Discord", "All sources"]} value={value} onValueChange={() => {}} />,
    );
    const options = markup.match(/<button[^>]*role="option"[\s\S]*?<\/button>/g) ?? [];

    expect(options).toHaveLength(3);
    expect(markup.match(/lucide-check\b/g)).toHaveLength(1);
    for (const option of options) {
      expect(option.includes("lucide-check")).toBe(option.includes('aria-selected="true"'));
      expect(option).toContain('class="custom-select-indicator" aria-hidden="true"');
    }
  });

  it("renders decorative option artwork and carries the selected logo into the trigger", () => {
    const markup = renderToStaticMarkup(
      <CustomSelect
        ariaLabel="Source"
        name="source"
        options={[
          { label: "Slack", value: "slack", icon: <svg data-brand="slack" /> },
          { label: "Email", value: "email" },
        ]}
        value="slack"
        onValueChange={() => {}}
      />,
    );
    expect(markup.match(/data-brand="slack"/g)).toHaveLength(2);
    expect(markup.match(/class="custom-select-option-icon" aria-hidden="true"/g)).toHaveLength(2);
    expect(markup).toContain('aria-label="Source: Slack"');
    expect(markup).toContain('name="source" value="slack"');
  });

  it("preserves an explicitly supplied leading icon", () => {
    const markup = renderToStaticMarkup(
      <CustomSelect ariaLabel="Source" options={[{ label: "Slack", value: "slack", icon: <svg data-brand="slack" /> }]} value="slack" leadingIcon={<svg data-icon="custom" />} onValueChange={() => {}} />,
    );
    expect(markup.match(/data-brand="slack"/g)).toHaveLength(1);
    expect(markup).toContain('data-icon="custom"');
  });

  it("does not falsely mark an option when the value is absent", () => {
    const markup = renderToStaticMarkup(
      <CustomSelect ariaLabel="Source" options={["Slack", "Email"]} value="missing" onValueChange={() => {}} />,
    );
    expect(markup).not.toContain("lucide-check");
    expect(markup).not.toContain('aria-selected="true"');
  });
});
