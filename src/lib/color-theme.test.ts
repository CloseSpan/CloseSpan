import { describe, expect, it } from "vitest";
import { isColorTheme, nextColorTheme } from "./color-theme";

describe("color theme", () => {
  it("accepts only supported theme values", () => {
    expect(isColorTheme("light")).toBe(true);
    expect(isColorTheme("dark")).toBe(true);
    expect(isColorTheme("system")).toBe(false);
    expect(isColorTheme(null)).toBe(false);
  });

  it("moves directly between light and dark modes", () => {
    expect(nextColorTheme("light")).toBe("dark");
    expect(nextColorTheme("dark")).toBe("light");
  });
});
