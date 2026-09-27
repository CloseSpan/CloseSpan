import { renderToStaticMarkup } from "react-dom/server";
import { Bot, CircleCheck, CircleDot, FlaskConical, Gauge, Grid2X2Plus, Inbox, LayoutGrid, Palette, Settings, Settings2, ShieldCheck, Users } from "lucide-react";
import { describe, expect, it } from "vitest";
import { NavigationIcon } from "./navigation-icon";

describe("navigation icon selection", () => {
  it.each([Bot, CircleCheck, CircleDot, FlaskConical, Gauge, Grid2X2Plus, Inbox, LayoutGrid, Palette, Settings, Settings2, ShieldCheck, Users])("only fills selected icons", (Icon) => {
    const inactive = renderToStaticMarkup(<NavigationIcon icon={Icon} />);
    const active = renderToStaticMarkup(<NavigationIcon icon={Icon} active />);
    expect(inactive).toContain('data-icon-variant="outline"');
    expect(inactive).not.toContain('class="navigation-icon-detail"');
    expect(active).toContain('data-icon-variant="filled"');
    expect(active).toContain('aria-hidden="true"');
  });

  it.each([Bot, CircleCheck, CircleDot, FlaskConical, Gauge, Inbox, Palette, Settings, ShieldCheck])("preserves detail inside filled silhouettes", (Icon) => {
    const active = renderToStaticMarkup(<NavigationIcon icon={Icon} active />);
    expect(active).toMatch(/class="navigation-icon-(detail|cutout)"/);
  });
});
