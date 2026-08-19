import { describe, expect, it } from "vitest";
import {
  isProductCodeReference,
  repositoryPathFromReference,
} from "./repository-path-policy";

describe("repository product path policy", () => {
  it("keeps application source references and removes internal search artifacts", () => {
    expect(isProductCodeReference("Zup/PostContextView.swift:40-72")).toBe(true);
    expect(isProductCodeReference("src/components/menu.tsx:12")).toBe(true);
    expect(isProductCodeReference(".prompt/tickets/request.md:26-73")).toBe(false);
    expect(isProductCodeReference(".github/skills/impeccable/reference/init.md:2-49")).toBe(false);
    expect(isProductCodeReference("docs/product-behavior.md:5-20")).toBe(false);
  });

  it("separates the repository path from its line range", () => {
    expect(repositoryPathFromReference("src/components/menu.tsx:12-34"))
      .toBe("src/components/menu.tsx");
  });
});
