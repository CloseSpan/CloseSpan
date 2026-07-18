"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import type { OverviewAnalytics } from "@/lib/overview-analytics";

export function FeedbackVolumeChart({ analytics }: { analytics: OverviewAnalytics }) {
  const series = analytics.feedbackSeries;
  const [source, setSource] = useState("All sources");
  const [activeWeek, setActiveWeek] = useState<number | null>(null);
  const [pinnedWeek, setPinnedWeek] = useState<number | null>(null);
  const reduceMotion = useReducedMotion();
  const values = series[source] ?? series["All sources"] ?? [];
  const total = values.reduce((sum, value) => sum + value, 0);

  function selectWeek(index: number) {
    const next = pinnedWeek === index ? null : index;
    setPinnedWeek(next);
    setActiveWeek(next);
  }

  return <section className="card feedback-volume-card">
    <div className="card-head">
      <div><h2>Feedback volume</h2><p className="subtle">Customer signals received · last 8 weeks</p></div>
      <label className="chart-source"><span className="sr-only">Feedback source</span><select value={source} onChange={(event) => { setSource(event.target.value); setActiveWeek(null); setPinnedWeek(null); }}>{Object.keys(series).map((name) => <option key={name}>{name}</option>)}</select></label>
    </div>
    <div className="card-body">
      <div className="chart-summary" aria-live="polite"><strong>{total}</strong> signals from {source.toLowerCase()}</div>
      <div className="chart" aria-label={`Weekly feedback volume for ${source}: ${values.map((value, index) => `week ${index + 1}, ${value} signals`).join("; ")}`}>
        {values.map((value, index) => {
          const active = activeWeek === index;
          return <div className={`chart-col${active ? " active" : ""}`} key={`${source}-${index}`}>
            <div className="chart-bar-shell">
              <motion.button
                type="button"
                className="chart-bar"
                initial={reduceMotion ? false : { height: 0, opacity: 0.5 }}
                animate={{ height: `${value}%`, opacity: activeWeek === null || active ? 1 : 0.45, scale: active ? 1.04 : 1 }}
                transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 170, damping: 22, delay: index * 0.035 }}
                aria-label={`Week ${index + 1}: ${value} signals${pinnedWeek === index ? ", selected" : ""}`}
                aria-pressed={pinnedWeek === index}
                onClick={() => selectWeek(index)}
                onMouseEnter={() => setActiveWeek(index)}
                onMouseLeave={() => setActiveWeek(pinnedWeek)}
                onFocus={() => setActiveWeek(index)}
                onBlur={() => setActiveWeek(pinnedWeek)}
                onKeyDown={(event) => { if (event.key === "Escape") { setPinnedWeek(null); setActiveWeek(null); } }}
              >
                <motion.span className="chart-tooltip" initial={false} animate={{ opacity: active ? 1 : 0, y: active ? 0 : 4 }} transition={{ duration: reduceMotion ? 0 : 0.16 }} aria-hidden={!active}><strong>{value}</strong><small>signals</small></motion.span>
              </motion.button>
            </div>
            <small>W{index + 1}</small>
          </div>;
        })}
      </div>
      <p className="chart-help">Hover or focus a bar for details. Select a bar to keep it highlighted.</p>
    </div>
  </section>;
}
