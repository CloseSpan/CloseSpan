import { ImageResponse } from "next/og";

export const alt =
  "Closespan — turn customer feedback into verified product fixes";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "68px 76px",
          color: "#f8f9fd",
          background:
            "radial-gradient(circle at 82% 12%, #393480 0%, transparent 34%), linear-gradient(145deg, #080d19 0%, #0d1528 58%, #111a31 100%)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            fontSize: 56,
            fontWeight: 720,
            letterSpacing: "-0.055em",
          }}
        >
          <span
            style={{
              color: "#aaa4ff",
              fontFamily: "monospace",
              fontSize: 51,
              fontWeight: 850,
              letterSpacing: "-0.12em",
            }}
          >
            {"</"}
          </span>
          <span style={{ display: "flex", color: "#ffffff", margin: "0 6px" }}>
            <span style={{ fontWeight: 720 }}>Close</span>
            <span style={{ fontWeight: 900 }}>Span</span>
          </span>
          <span
            style={{
              color: "#756cff",
              fontFamily: "monospace",
              fontSize: 51,
              fontWeight: 850,
            }}
          >
            {">"}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          <div
            style={{
              color: "#aaa4ff",
              fontSize: 20,
              fontWeight: 800,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            AI feedback-to-fix operations for B2B SaaS
          </div>
          <div
            style={{
              maxWidth: 990,
              fontSize: 68,
              fontWeight: 800,
              lineHeight: 1.04,
              letterSpacing: "-0.045em",
            }}
          >
            Turn customer feedback into verified product fixes.
          </div>
          <div style={{ color: "#aeb8cb", fontSize: 26 }}>
            Evidence → impact → approved action → verified resolution
          </div>
        </div>
      </div>
    ),
    size,
  );
}
