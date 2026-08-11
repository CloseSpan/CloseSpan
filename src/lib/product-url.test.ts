import { describe, expect, it } from "vitest";
import { addDefaultHttpsScheme } from "./product-url";

describe("addDefaultHttpsScheme", () => {
  it("adds HTTPS to a bare product domain", () => {
    expect(addDefaultHttpsScheme(" closespan.com ")).toBe("https://closespan.com");
  });

  it.each([
    "https://closespan.com",
    "http://localhost:3000",
  ])("preserves an existing HTTP scheme in %s", (value) => {
    expect(addDefaultHttpsScheme(value)).toBe(value);
  });

  it("leaves an empty optional URL empty", () => {
    expect(addDefaultHttpsScheme("   ")).toBe("");
  });
});
