"use client";

import { ExternalLink, Globe2, LoaderCircle, Search } from "lucide-react";
import { useRef, useState } from "react";
import {
  discoverPublicFeedbackSources,
  normalizeProductUrl,
  type PublicSourceDiscoveryResponse,
  type PublicSourceKind,
} from "@/lib/integration-client";
import type { ProductProfile } from "@/lib/onboarding-repository";

const KIND_LABELS: Record<PublicSourceKind, string> = {
  app_store: "Apple App Store",
  play_store: "Google Play",
  review_site: "Review site",
  community: "Community",
  social: "Social",
  other: "Public web",
};

function productHost(value: string | null): string | null {
  const normalized = normalizeProductUrl(value);
  if (!normalized) return null;
  try {
    return new URL(normalized).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function compactText(value: string, maxLength = 160): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  const firstSentence = normalized.split(/(?<=[.!?])\s/)[0] ?? normalized;
  return firstSentence.length > maxLength
    ? `${firstSentence.slice(0, maxLength - 1).trimEnd()}…`
    : firstSentence;
}

export function PublicSourceDiscovery({
  orgId,
  productProfile,
}: {
  orgId: string;
  productProfile: ProductProfile;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] =
    useState<PublicSourceDiscoveryResponse | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const requestRef = useRef(0);
  const host = productHost(productProfile.productUrl);

  async function discover() {
    if (busy) return;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setBusy(true);
    setResult(null);
    setUnavailable(false);
    try {
      const next = await discoverPublicFeedbackSources({ orgId, productProfile });
      if (requestRef.current === requestId) setResult(next);
    } catch {
      if (requestRef.current === requestId) setUnavailable(true);
    } finally {
      if (requestRef.current === requestId) setBusy(false);
    }
  }

  return (
    <section className="delphi-product-card" aria-labelledby="product-understood">
      <div className="delphi-product-head">
        <div className="delphi-product-icon" aria-hidden="true">
          <Globe2 size={17} />
        </div>
        <div>
          <span className="delphi-product-status">Product</span>
          <h2 id="product-understood">
            {productProfile.productName || host || "Your product"}
          </h2>
          {host && productProfile.productName && <p>{host}</p>}
        </div>
      </div>

      {productProfile.productDescription && (
        <p className="delphi-product-description">
          {compactText(productProfile.productDescription)}
        </p>
      )}

      <div className="public-discovery-intro">
        <div>
          <strong>Find public feedback</strong>
          <p>Search public reviews and communities.</p>
        </div>
        <button
          className="btn"
          type="button"
          disabled={busy}
          onClick={() => void discover()}
        >
          {busy ? (
            <LoaderCircle className="spin" size={14} aria-hidden="true" />
          ) : (
            <Search size={14} aria-hidden="true" />
          )}
          {busy
            ? "Searching..."
            : result?.status === "completed"
              ? "Search again"
              : "Find sources"}
        </button>
      </div>

      <div aria-live="polite">
        {(unavailable || result?.status === "unavailable") && (
          <p className="public-discovery-note">
            Public search unavailable. Connect a feedback source below.
          </p>
        )}
        {result?.status === "disabled" && (
          <p className="public-discovery-note">
            Public search is not enabled.
          </p>
        )}
        {result?.status === "completed" && result.sources.length === 0 && (
          <p className="public-discovery-note">
            No public feedback found.
          </p>
        )}
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {result?.status === "completed"
          ? `Public source search complete. ${result.sources.length} possible ${
              result.sources.length === 1 ? "source" : "sources"
            } found.`
          : ""}
      </p>

      {result?.status === "completed" && result.sources.length > 0 && (
        <div className="public-source-results">
          <div className="public-source-results-head">
            <strong>Public sources</strong>
            <span>
              Found via {result.provider === "you" ? "You.com" : "public web"}
            </span>
          </div>
          <div className="public-source-grid">
            {result.sources.map((source) => (
              <article className="public-source-card" key={source.id}>
                <div className="public-source-card-head">
                  <span>{KIND_LABELS[source.kind]}</span>
                  <span>{source.confidence} confidence</span>
                </div>
                <h3>{source.title}</h3>
                <small>{source.host}</small>
                <p>{compactText(source.reason, 120)}</p>
                <a
                  className="text-link"
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open source
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              </article>
            ))}
          </div>
          <p className="public-source-confirmation">
            Public results are suggestions, not connected sources.
          </p>
        </div>
      )}
    </section>
  );
}
