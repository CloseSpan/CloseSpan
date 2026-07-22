import { Info } from "lucide-react";

export type ConnectorGuidanceMode = "full" | "compact" | "hidden";

export function ConnectorInputGuidance({
  mode,
}: {
  mode: ConnectorGuidanceMode;
}) {
  if (mode === "hidden") return null;

  return (
    <div
      className={`connector-input-guidance${mode === "compact" ? " compact" : ""}`}
      role="note"
    >
      <Info size={15} aria-hidden="true" />
      {mode === "compact" ? (
        <p>
          Enter only the subdomain, for example <code>miraai</code>.
        </p>
      ) : (
        <p>
          <strong>Enter only your Zendesk subdomain.</strong>
          For <code>https://miraai.zendesk.com</code>, enter <code>miraai</code>.
          Do not paste the full URL or <code>.zendesk.com</code>.
        </p>
      )}
    </div>
  );
}
