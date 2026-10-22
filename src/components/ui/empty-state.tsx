import { Info, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ButtonLink } from "./button";

/**
 * The one empty state: icon, title, a sentence of context and, when there is
 * somewhere useful to go, a single action.
 */
export function EmptyState({
  icon: Icon = Info,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: { href: string; label: string } | ReactNode;
}) {
  return (
    <section className="card empty-state">
      <Icon aria-hidden="true" size={28} />
      <h2>{title}</h2>
      {description && <p className="subtle">{description}</p>}
      {action && typeof action === "object" && "href" in action && "label" in action
        ? <ButtonLink variant="primary" href={action.href as string}>{action.label as string}</ButtonLink>
        : action}
    </section>
  );
}
