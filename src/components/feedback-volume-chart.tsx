"use client";

import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useId, useState } from "react";
import type { OverviewAnalytics } from "@/lib/overview-analytics";
import { CustomSelect } from "./custom-select";

export function normalizeChartBarHeight(value: number, maximum: number): number {
  if (value <= 0 || maximum <= 0) return 0;
  return Math.min(100, (value / maximum) * 100);
}

export function FeedbackVolumeChart({ analytics }: { analytics: OverviewAnalytics }) {
  const series = analytics.feedbackSeries;
  const [source, setSource] = useState("All sources");
  const [activeWeek, setActiveWeek] = useState<number | null>(null);
  const [pinnedWeek, setPinnedWeek] = useState<number | null>(null);
  const reduceMotion = useReducedMotion();
  const chartHelpId = useId();
  const values = series[source] ?? series["All sources"] ?? [];
  const weeks = analytics.feedbackWeeks;
  const total = values.reduce((sum, value) => sum + value, 0);
  const maxVisibleValue = Math.max(...values, 1);

  function selectWeek(index: number) {
    const next = pinnedWeek === index ? null : index;
    setPinnedWeek(next);
    setActiveWeek(next);
  }

  return <section className="card feedback-volume-card">
    <div className="card-head">
      <div><h2>Feedback volume</h2><p className="subtle">Customer signals received · last 8 weeks</p></div>
      <CustomSelect
        ariaLabel="Feedback source"
        className="chart-source"
        value={source}
        options={Object.keys(series)}
        onValueChange={(nextSource) => {
          setSource(nextSource);
          setActiveWeek(null);
          setPinnedWeek(null);
        }}
      />
    </div>
    <div className="card-body">
      <div className="chart-summary" aria-live="polite"><strong>{total}</strong> signals from {source.toLowerCase()}</div>
      <div
        className={`chart${total === 0 ? " chart-is-empty" : ""}`}
        role="group"
        aria-label={`Weekly feedback volume for ${source}`}
        aria-describedby={chartHelpId}
      >
        {total === 0 ? <div className="chart-empty-state" role="status">
          <strong>No feedback in this period</strong>
          <span>Run an import to bring customer signals into CloseSpan.</span>
          <Link href="/integrations">Import feedback</Link>
        </div> : null}
        {values.map((value, index) => {
          const active = activeWeek === index;
          const week = weeks[index];
          const weekLabel = week?.label ?? `Week ${index + 1}`;
          const weekShortLabel = week?.shortLabel ?? `Week ${index + 1}`;
          return <div className={`chart-col${active ? " active" : ""}`} key={`${source}-${week?.startDate ?? index}`}>
            <div className="chart-bar-shell">
              {value > 0 ? <motion.button
                  type="button"
                  className="chart-bar"
                  data-chart-value={value}
                  initial={reduceMotion ? false : { height: 0, opacity: 0.5 }}
                  animate={{ height: `${normalizeChartBarHeight(value, maxVisibleValue)}%`, opacity: activeWeek === null || active ? 1 : 0.45, scale: active ? 1.04 : 1 }}
                  transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 170, damping: 22, delay: index * 0.035 }}
                  aria-label={`${weekLabel}: ${value} signals${pinnedWeek === index ? ", selected" : ""}`}
                  aria-pressed={pinnedWeek === index}
                  onClick={() => selectWeek(index)}
                  onMouseEnter={() => setActiveWeek(index)}
                  onMouseLeave={() => setActiveWeek(pinnedWeek)}
                  onFocus={() => setActiveWeek(index)}
                  onBlur={() => setActiveWeek(pinnedWeek)}
                  onKeyDown={(event) => { if (event.key === "Escape") { setPinnedWeek(null); setActiveWeek(null); } }}
                >
                  <motion.span className="chart-tooltip" initial={false} animate={{ opacity: active ? 1 : 0, y: active ? 0 : 4 }} transition={{ duration: reduceMotion ? 0 : 0.16 }} aria-hidden={!active}><strong>{value}</strong><small>{value === 1 ? "signal" : "signals"} · {weekLabel}</small></motion.span>
                </motion.button> : <span className="chart-zero-marker" data-chart-value="0" title={`${weekLabel}: 0 signals`} aria-hidden="true" />}
            </div>
            <small title={weekLabel}>{weekShortLabel}</small>
          </div>;
        })}
      </div>
      <table className="sr-only">
        <caption>Weekly feedback volume for {source}</caption>
        <thead>
          <tr>
            <th scope="col">Week</th>
            <th scope="col">Signals</th>
          </tr>
        </thead>
        <tbody>
          {values.map((value, index) => (
            <tr key={`accessible-${source}-${weeks[index]?.startDate ?? index}`}>
              <th scope="row">{weeks[index]?.label ?? `Week ${index + 1}`}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="chart-help" id={chartHelpId}>{total > 0 ? "Hover or focus a bar for details. Select a bar to keep it highlighted." : "Imported feedback will appear here using its original received date."}</p>
    </div>
  </section>;
}
