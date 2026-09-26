import { ChevronRight } from "lucide-react";
import { requireWorkspaceUser } from "@/lib/auth-user";
import { WORKSPACE_LABELS } from "@/lib/workspace-labels";

const groups = [
  { title: "Workspace tools", items: [
    [WORKSPACE_LABELS.feedback, "/feedback"], [WORKSPACE_LABELS.customers, "/customers"], [WORKSPACE_LABELS["follow-up"], "/follow-up"],
  ] },
  { title: "Technical settings", items: [
    ["AI provider", "/settings#model"], ["Prompt policies", "/settings#prompt-drafts"],
    ["Validation", "/settings#prompt-evaluation"], ["Execution environments", "/settings#execution"],
    ["Workflow orchestration", "/settings#orchestration"], ["Prioritization", "/settings#priority"],
    [WORKSPACE_LABELS["agent-runs"], "/agent-runs"],
  ] },
];

export default async function TechnicalSettingsPage() {
  await requireWorkspaceUser();
  return <div className="settings-tools-page">
    <header className="page-head"><h1>More settings</h1></header>
    {groups.map((group) => <section className="settings-tools-group" key={group.title}>
      <h2>{group.title}</h2>
      <nav aria-label={group.title}>{group.items.map(([label, href]) => (
        <a className="settings-tool-link" href={href} key={href}>
          <span>{label}</span><ChevronRight size={16} aria-hidden="true" />
        </a>
      ))}</nav>
    </section>)}
  </div>;
}
