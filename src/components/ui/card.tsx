import type { ComponentProps, ReactNode } from "react";

/** A titled card: heading row with optional actions, then the body. */
export function Card({ title, actions, children, className, ...props }: Omit<ComponentProps<"section">, "title"> & { title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={["card", className].filter(Boolean).join(" ")} {...props}>
      {(title || actions) && <div className="card-head">{typeof title === "string" ? <h2>{title}</h2> : title}{actions}</div>}
      <div className="card-body">{children}</div>
    </section>
  );
}
