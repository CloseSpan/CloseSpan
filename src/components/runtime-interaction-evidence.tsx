import { StatusBadge } from "@/components/ui";
import type { AgentImplementationReport } from "@/lib/agent-run-verification";

type RuntimeInteraction = NonNullable<
  AgentImplementationReport["runtimeEvidence"]
>["interactions"][number];

export function runtimeInteractionStageLabel(
  stage: RuntimeInteraction["stage"],
): string {
  if (stage === "verification") return "Verification VM";
  if (stage === "implementation") return "Implementation VM";
  return "Runtime";
}

export function RuntimeInteractionEvidence({
  interaction,
}: {
  interaction: RuntimeInteraction;
}) {
  return (
    <details className="callout">
      <summary>
        <StatusBadge>
          {runtimeInteractionStageLabel(interaction.stage)}
        </StatusBadge>{" "}
        <span className="runtime-tool-name">{interaction.tool}</span>{" "}
        {interaction.status}
      </summary>
      <p className="subtle">{interaction.target}</p>
      <pre className="code-block">{interaction.evidence}</pre>
    </details>
  );
}
