"use client";

import { useSyncExternalStore } from "react";
import { Columns3, List } from "lucide-react";
import { Liquid } from "liquid-gooey";
import styles from "./gooey-view-switch.module.css";

type IssueView = "list" | "board";
const staticHighlightQuery = "(prefers-reduced-motion: reduce), (forced-colors: active)";
const travel = 92; // One 88px choice plus the 4px gap; labels never move.
const transition = { duration: 260, ease: "cubic-bezier(0.16, 1, 0.3, 1)" };

function subscribe(callback: () => void) {
  const query = window.matchMedia(staticHighlightQuery);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function motionAllowed() {
  return !window.matchMedia(staticHighlightQuery).matches;
}

function serverMotionAllowed() { return false; }

/** Goo is presentation only; native buttons own focus, hit targets and state. */
export function GooeyViewSwitch({ value, onChange }: {
  value: IssueView;
  onChange: (view: IssueView) => void;
}) {
  const animate = useSyncExternalStore(subscribe, motionAllowed, serverMotionAllowed);
  const x = value === "board" ? travel : 0;

  return <div className={styles.switch} role="group" aria-label="Issue view" data-gooey-view-switch data-motion={animate ? "gooey" : "static"}>
    {animate && <Liquid className={styles.liquid} style={{ position: "absolute", inset: 0 }}
      aria-hidden="true" blur={6} contrast={18} fill="var(--surface-pressed)" filterPadding={12}>
      <Liquid.Item className={styles.body} radius={8} x={x} transition={transition}>
        <span className={styles.shape} />
      </Liquid.Item>
      <Liquid.Item className={styles.drop} radius={14} x={x} transition={transition} delay={45}>
        <span className={styles.shape} />
      </Liquid.Item>
    </Liquid>}
    <button type="button" className={styles.choice} aria-pressed={value === "list"} onClick={() => onChange("list")}>
      <List size={16} aria-hidden="true" />List
    </button>
    <button type="button" className={styles.choice} aria-pressed={value === "board"} onClick={() => onChange("board")}>
      <Columns3 size={16} aria-hidden="true" />Board
    </button>
  </div>;
}
