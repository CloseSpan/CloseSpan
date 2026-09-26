"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Liquid } from "liquid-gooey";
import { listenForGooeyInteractions, type GooeyFrame } from "@/lib/gooey-interactions";
import styles from "./gooey-interactions.module.css";

const transition = { duration: 260, ease: "cubic-bezier(0.16, 1, 0.3, 1)" };

function GooeyResponse({ frame }: { frame: GooeyFrame }) {
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    // Let both silhouettes paint at the same origin before they separate/merge.
    const id = requestAnimationFrame(() => setMoving(true));
    return () => cancelAnimationFrame(id);
  }, []);
  // Even an edge-only field response needs enough silhouette for the goo filter.
  const size = Math.min(Math.max(frame.height, 12), 44);
  const width = Math.min(frame.width * 0.58, 120);
  const x = moving ? frame.width + size : -width;
  const y = (frame.height - size) / 2;

  return <div data-gooey-interaction aria-hidden="true" className={styles.overlay}
    style={{ left: frame.left, top: frame.top, width: frame.width, height: frame.height, borderRadius: frame.radius, color: frame.color }}>
    <Liquid blur={frame.field ? 2 : 6} contrast={18} fill="currentColor" filterPadding={12}
      className={styles.liquid} style={{ position: "absolute", inset: 0 }}>
      <Liquid.Item x={x} y={y} radius={size / 2} transition={transition}
        style={{ position: "absolute", width, height: size }}><span /></Liquid.Item>
      <Liquid.Item x={x} y={y} radius={size / 2} transition={transition} delay={40}
        style={{ position: "absolute", width: size, height: size }}><span /></Liquid.Item>
    </Liquid>
  </div>;
}

/** Shared by public pages, workspaces, dropdowns and dialogs; zero idle filters. */
export function GooeyInteractions() {
  const [response, setResponse] = useState<{ frame: GooeyFrame; id: number } | null>(null);
  useEffect(() => {
    let sequence = 0;
    return listenForGooeyInteractions((frame) => setResponse(frame ? { frame, id: ++sequence } : null));
  }, []);
  return response ? createPortal(<GooeyResponse key={response.id} frame={response.frame} />, document.body) : null;
}
