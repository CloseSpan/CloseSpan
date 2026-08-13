import { describe, expect, it } from "vitest";
import { buildProblemRepositoryContextQuery } from "./problem-evidence-bundle";

describe("problem evidence bundle", () => {
  it("asks the repository index for solution context without presenting matches as root cause proof", () => {
    const query = buildProblemRepositoryContextQuery({
      title: "The Post Context input is reported as nonfunctional",
      statement: "Entering post context does not change the generated result.",
      summary: "One customer report describes the same workflow.",
      hypothesis: "The input may not reach prompt assembly.",
      proposedAction: "Trace the input through prompt construction.",
      missingInformation: ["Runtime reproduction"],
      suspectedFiles: [],
    });

    expect(query).toContain("implementation path");
    expect(query).toContain("nearest tests");
    expect(query).toContain("Cite exact source locations");
    expect(query).toContain("leads, not proof of root cause");
    expect(query).toContain("Runtime reproduction");
  });
});
