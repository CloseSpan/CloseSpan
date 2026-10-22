import Link from "next/link";
import type { ComponentProps } from "react";

export type ButtonVariant = "primary" | "danger" | "success" | "warning";

function buttonClass(variant: ButtonVariant | undefined, large: boolean | undefined, className: string | undefined): string {
  return ["btn", variant, large ? "large" : null, className].filter(Boolean).join(" ");
}

type ButtonOptions = { variant?: ButtonVariant; large?: boolean };

/** The workspace button. Without a variant it is the neutral outlined style. */
export function Button({ variant, large, className, ...props }: ComponentProps<"button"> & ButtonOptions) {
  return <button className={buttonClass(variant, large, className)} {...props} />;
}

/** A link styled as a button, for navigation actions. */
export function ButtonLink({ variant, large, className, ...props }: ComponentProps<typeof Link> & ButtonOptions) {
  return <Link className={buttonClass(variant, large, className)} {...props} />;
}
