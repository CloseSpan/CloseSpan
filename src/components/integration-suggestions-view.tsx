"use client";

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  LoaderCircle,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import type {
  IntegrationActivityItem,
  IntegrationActivitySection,
  IntegrationInspectionMode,
} from "@/lib/integration-suggestions";
import { inspectionModeForActivity } from "@/lib/integration-suggestions";
import { FitText } from "./fit-text";
import { IntegrationProviderIcon } from "./integration-provider-icon";

const sections: readonly IntegrationActivitySection[] = [
  "Suggested",
  "Working",
  "Review",
  "Done",
];

const sectionCopy: Record<
  IntegrationActivitySection,
  { description: string; empty: string }
> = {
  Suggested: {
    description: "Sources selected from your product profile and connector catalog.",
    empty: "No new connectors are recommended right now.",
  },
  Working: {
    description: "Connections and imports currently moving in the background.",
    empty: "Nothing is running in the background.",
  },
  Review: {
    description: "Items that need a decision, reconnect, or first import.",
    empty: "No integration needs your attention.",
  },
  Done: {
    description: "Connections and imports that are ready for the workspace.",
    empty: "Completed integration work will appear here.",
  },
};

function formatActivityTime(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function SectionStatusIcon({ section }: { section: IntegrationActivitySection }) {
  if (section === "Working") {
    return <LoaderCircle className="spin" size={15} aria-hidden="true" />;
  }
  if (section === "Review") {
    return <AlertTriangle size={15} aria-hidden="true" />;
  }
  if (section === "Done") {
    return <CheckCircle2 size={15} aria-hidden="true" />;
  }
  return <Sparkles size={15} aria-hidden="true" />;
}

function reviewActionLabel(item: IntegrationActivityItem): string {
  if (item.primaryAction.kind === "review_details") {
    return item.primaryAction.label;
  }
  if (item.primaryAction.kind === "connect") return "Review & connect";
  if (item.primaryAction.kind === "reconnect") return "Review & reconnect";
  if (item.primaryAction.kind === "retry_import") return "Review & retry";
  return "Review & pull";
}

export function IntegrationSuggestionsView({
  items,
  productName,
  onInspect,
}: {
  items: IntegrationActivityItem[];
  productName: string | null;
  onInspect: (
    integrationId: string,
    mode?: IntegrationInspectionMode,
  ) => void;
}) {
  const [openSections, setOpenSections] = useState<
    Record<IntegrationActivitySection, boolean>
  >({ Suggested: true, Working: true, Review: true, Done: false });
  const attentionCount = items.filter(
    (item) => item.section === "Suggested" || item.section === "Review",
  ).length;

  return (
    <section
      className="integration-suggestion-board"
      aria-labelledby="integration-suggestion-board-title"
    >
      <header className="integration-suggestion-board-head">
        <div>
          <span className="eyebrow">Smart suggestions</span>
          <h2 id="integration-suggestion-board-title">Next integration steps</h2>
          <p>
            Based on {productName ? `${productName}'s` : "this workspace's"}
            {" "}product context and live connection health.
          </p>
        </div>
        <span className="integration-suggestion-live-badge">
          <Sparkles size={14} aria-hidden="true" />
          Live workspace data
        </span>
      </header>

      <span className="sr-only" aria-live="polite">
        {attentionCount} integration suggestion
        {attentionCount === 1 ? "" : "s"} available.
      </span>

      <div className="integration-suggestion-sections">
        {sections.map((section) => {
          const sectionItems = items.filter((item) => item.section === section);
          const shouldShow =
            sectionItems.length > 0 ||
            section === "Working" ||
            section === "Review";
          if (!shouldShow) return null;

          return (
            <details
              className={`integration-suggestion-section section-${section.toLowerCase()}`}
              key={section}
              open={openSections[section]}
              onToggle={(event) => {
                const open = event.currentTarget.open;
                setOpenSections((current) =>
                  current[section] === open
                    ? current
                    : { ...current, [section]: open },
                );
              }}
            >
              <summary>
                <ChevronRight size={16} aria-hidden="true" />
                <span>{section}</span>
                <small>{sectionItems.length}</small>
              </summary>
              <div className="integration-suggestion-section-body">
                <p className="integration-suggestion-section-description">
                  {sectionCopy[section].description}
                </p>
                {sectionItems.length === 0 ? (
                  <p className="integration-suggestion-empty">
                    <CheckCircle2 size={15} aria-hidden="true" />
                    {sectionCopy[section].empty}
                  </p>
                ) : (
                  <div className="integration-suggestion-list">
                    {sectionItems.map((item) => {
                      const formattedTime = formatActivityTime(item.at);
                      const actionLabel = reviewActionLabel(item);
                      return (
                        <button
                          className="integration-suggestion-row"
                          type="button"
                          key={item.id}
                          onClick={() =>
                            onInspect(
                              item.integrationId,
                              inspectionModeForActivity(item),
                            )
                          }
                          aria-label={`${actionLabel}: ${item.title}`}
                        >
                          <IntegrationProviderIcon
                            integrationId={item.integrationId}
                            className="compact"
                          />
                          <span className="integration-suggestion-row-copy">
                            <FitText as="strong" minFontSize={11} maxLines={2}>
                              {item.title}
                            </FitText>
                            <span>{item.description}</span>
                            <small>
                              <SectionStatusIcon section={section} />
                              {item.filter}
                              {item.count !== null && item.count > 0
                                ? ` · ${item.count.toLocaleString()} processed`
                                : ""}
                            </small>
                          </span>
                          {formattedTime && (
                            <time dateTime={item.at ?? undefined}>{formattedTime}</time>
                          )}
                          <span className="integration-suggestion-row-action">
                            {actionLabel}
                            <ArrowRight size={14} aria-hidden="true" />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
