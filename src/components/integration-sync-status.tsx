"use client";

import { AlertTriangle, Check, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  fetchIntegrationSyncStatus,
  type IntegrationConnectionState,
  type IntegrationSyncStatusResponse,
} from "@/lib/integration-client";

const ACTIVE_POLL_MS = 2_500;
const WAITING_POLL_MS = 4_000;
const IDLE_POLL_MS = 30_000;
const ERROR_POLL_MS = 8_000;

function recordLabel(count: number): string {
  return `${count.toLocaleString()} record${count === 1 ? "" : "s"}`;
}

export function IntegrationSyncStatus({
  orgId,
  integrationId,
  active,
  refreshKey = 0,
  onSucceeded,
  onConnectionStateChange,
}: {
  orgId: string;
  integrationId: string;
  active: boolean;
  refreshKey?: number;
  onSucceeded?: () => void;
  onConnectionStateChange?: (state: IntegrationConnectionState) => void;
}) {
  const [status, setStatus] =
    useState<IntegrationSyncStatusResponse | null>(null);
  const [readsFailed, setReadsFailed] = useState(0);
  const completedIdRef = useRef<string | null>(null);
  const onSucceededRef = useRef(onSucceeded);
  const onConnectionStateChangeRef = useRef(onConnectionStateChange);
  const connectionStateRef = useRef<IntegrationConnectionState | undefined>(
    undefined,
  );

  useEffect(() => {
    onSucceededRef.current = onSucceeded;
  }, [onSucceeded]);

  useEffect(() => {
    onConnectionStateChangeRef.current = onConnectionStateChange;
  }, [onConnectionStateChange]);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    let timer: number | undefined;
    connectionStateRef.current = undefined;

    async function poll() {
      try {
        const next = await fetchIntegrationSyncStatus({ orgId, integrationId });
        if (cancelled) return;
        setStatus(next);
        setReadsFailed(0);
        if (connectionStateRef.current !== next.connectionState) {
          connectionStateRef.current = next.connectionState;
          onConnectionStateChangeRef.current?.(next.connectionState);
        }
        if (
          next.sync?.status === "Succeeded" &&
          completedIdRef.current !== next.sync.id
        ) {
          completedIdRef.current = next.sync.id;
          onSucceededRef.current?.();
        }

        const activelySyncing =
          next.sync !== null &&
          ["Queued", "Running", "Retrying"].includes(next.sync.status);
        timer = window.setTimeout(
          poll,
          activelySyncing
            ? ACTIVE_POLL_MS
            : next.sync === null && next.connectionState === "Connected"
              ? WAITING_POLL_MS
              : IDLE_POLL_MS,
        );
      } catch {
        if (cancelled) return;
        setReadsFailed((current) => current + 1);
        timer = window.setTimeout(poll, ERROR_POLL_MS);
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [active, integrationId, orgId, refreshKey]);

  if (!active) return null;

  if (!status) {
    return readsFailed >= 2 ? (
      <p className="integration-import quiet" role="status">
        Import status will appear when it is available.
      </p>
    ) : (
      <p className="integration-import waiting" role="status">
        <LoaderCircle className="spin" size={13} aria-hidden="true" />
        Checking import status...
      </p>
    );
  }

  if (status.connectionState === "Needs reconnect") {
    return (
      <p className="integration-import failed" role="status">
        <AlertTriangle size={13} aria-hidden="true" />
        Reconnect this source to resume imports.
      </p>
    );
  }

  if (
    status.connectionState === "Disconnected" ||
    status.connectionState === null
  ) {
    return (
      <p className="integration-import failed" role="status">
        <AlertTriangle size={13} aria-hidden="true" />
        {status.connectionState === "Disconnected"
          ? "This source is disconnected. Connect it to resume imports."
          : "Connect this source to begin imports."}
      </p>
    );
  }

  const sync = status.sync;
  if (!sync) {
    return (
      <p className="integration-import waiting" role="status">
        <LoaderCircle className="spin" size={13} aria-hidden="true" />
        Connected · waiting for the first import
      </p>
    );
  }

  if (sync.status === "Succeeded") {
    return (
      <p className="integration-import succeeded">
        <Check size={13} aria-hidden="true" />
        <span role="status">Import complete</span>
        {sync.recordsProcessed > 0 && (
          <span> · {recordLabel(sync.recordsProcessed)} processed</span>
        )}
      </p>
    );
  }

  if (sync.status === "Failed") {
    return (
      <p className="integration-import failed">
        <AlertTriangle size={13} aria-hidden="true" />
        <span role="status">
          Import paused. Try again later or reconnect this source.
        </span>
      </p>
    );
  }

  const retrying = sync.status === "Retrying";
  return (
    <div className="integration-import-progress">
      <div>
        {retrying ? (
          <RefreshCw className="spin-slow" size={13} aria-hidden="true" />
        ) : (
          <LoaderCircle className="spin" size={13} aria-hidden="true" />
        )}
        <span role="status">
          {sync.status === "Queued"
            ? "Import queued"
            : retrying
              ? "Retrying import"
              : "Importing feedback"}
        </span>
        {sync.recordsProcessed > 0 && (
          <strong>{recordLabel(sync.recordsProcessed)} processed</strong>
        )}
      </div>
      <span className="integration-import-bar" aria-hidden="true">
        <span />
      </span>
    </div>
  );
}
