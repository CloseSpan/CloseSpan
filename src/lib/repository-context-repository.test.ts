import { describe, expect, it } from "vitest";
import {
  chunkRepositoryFile,
  rankRepositoryContextChunk,
  repositoryContextProviderConfigured,
  repositorySearchTerms,
} from "./repository-context-repository";

describe("CloseSpan repository context", () => {
  it("requires no third-party context provider configuration", () => {
    expect(repositoryContextProviderConfigured()).toBe(true);
  });

  it("turns a product report into useful repository search terms", () => {
    expect(
      repositorySearchTerms(
        "The Post Context input is reported as nonfunctional. Trace its UI binding, persistence, and prompt construction.",
      ),
    ).toEqual(expect.arrayContaining([
      "post",
      "context",
      "input",
      "nonfunctional",
      "textfield",
      "onchange",
      "stored",
      "caption",
    ]));
  });

  it("chunks long files with line citations and extracts declarations", () => {
    const content = [
      "struct PostContextView {",
      "  func submitPostContext() {}",
      "}",
      ...Array.from({ length: 180 }, (_, index) => `let value${index} = ${index}`),
    ].join("\n");
    const chunks = chunkRepositoryFile(content);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toMatchObject({ startLine: 1, ordinal: 0 });
    expect(chunks[0]?.declarations).toEqual(
      expect.arrayContaining(["PostContextView", "submitPostContext"]),
    );
    expect(chunks[1]!.startLine).toBeLessThanOrEqual(chunks[0]!.endLine);
  });

  it("ranks exact implementation and test evidence above generic text", () => {
    const query = "Trace why the Post Context input is nonfunctional from its UI binding and state.";
    const terms = repositorySearchTerms(query);
    const relevant = rankRepositoryContextChunk({
      path: "Zup/Features/PostContext/PostContextView.swift",
      content: `
        Text("Post context")
        TextField("Add context", text: $moment.context)
          .onChange(of: moment.context) { _, value in update(value) }
      `,
      declarations: ["PostContextView"],
      lexicalRank: 0.4,
      query,
      terms,
    });
    const generic = rankRepositoryContextChunk({
      path: "app/privacy/page.tsx",
      content: "The privacy policy explains that post context is optional input.",
      declarations: [],
      lexicalRank: 0.4,
      query,
      terms,
    });
    expect(relevant).toBeGreaterThan(generic);
  });
});
