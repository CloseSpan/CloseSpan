"use client";

import {
  layout,
  measureNaturalWidth,
  prepare,
  prepareWithSegments,
} from "@chenglou/pretext";
import {
  type CSSProperties,
  type ElementType,
  type HTMLAttributes,
  useEffect,
  useRef,
  useState,
} from "react";

type FitTextProps = Omit<HTMLAttributes<HTMLElement>, "children"> & {
  as?: ElementType;
  children: string;
  maxLines?: number;
  minFontSize?: number;
  maxFontSize?: number;
};

function numeric(value: string, fallback: number) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function transformedText(text: string, textTransform: string) {
  if (textTransform === "uppercase") return text.toLocaleUpperCase();
  if (textTransform === "lowercase") return text.toLocaleLowerCase();
  if (textTransform === "capitalize") {
    return text.replace(/(^|\s)(\S)/gu, (_, space: string, letter: string) =>
      `${space}${letter.toLocaleUpperCase()}`,
    );
  }
  return text;
}

/**
 * Keeps semantic DOM text while using Pretext to choose a font size that fits
 * a bounded number of lines. Use this for dynamic titles, not ordinary body
 * copy where natural wrapping is preferable.
 */
export function FitText({
  as: Component = "span",
  children,
  maxLines = 2,
  minFontSize = 12,
  maxFontSize,
  className,
  style,
  ...props
}: FitTextProps) {
  const ref = useRef<HTMLElement | null>(null);
  const initialMaxRef = useRef<number | null>(maxFontSize ?? null);
  const [fontSize, setFontSize] = useState<number | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;

    let frame = 0;
    let disposed = false;
    const fit = (width: number) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (disposed || width <= 0) return;
        const computed = window.getComputedStyle(node);
        const computedSize = numeric(computed.fontSize, 16);
        if (initialMaxRef.current === null) initialMaxRef.current = computedSize;
        const upperBound = Math.max(
          minFontSize,
          Math.floor(maxFontSize ?? initialMaxRef.current ?? computedSize),
        );
        const weight = computed.fontWeight || "400";
        const fontStyle = computed.fontStyle || "normal";
        const family = computed.fontFamily || "Inter, Arial, sans-serif";
        const measuredText = transformedText(children, computed.textTransform);
        const letterSpacing =
          computed.letterSpacing === "normal"
            ? 0
            : numeric(computed.letterSpacing, 0);
        const lineHeightRatio =
          computed.lineHeight === "normal"
            ? 1.35
            : numeric(computed.lineHeight, computedSize * 1.35) / computedSize;

        let low = Math.min(minFontSize, upperBound);
        let high = upperBound;
        let best = low;
        while (low <= high) {
          const candidate = Math.floor((low + high) / 2);
          // Canvas/Pretext font parsing is stricter than CSS. In particular,
          // computed stretch values such as `100%` can invalidate the whole
          // shorthand and silently measure with a fallback face.
          const font = `${fontStyle} ${weight} ${candidate}px ${family}`;
          const fits = maxLines === 1
            ? measureNaturalWidth(
                prepareWithSegments(measuredText, font, { letterSpacing }),
              ) <= width
            : layout(
                prepare(measuredText, font, { letterSpacing }),
                width,
                candidate * lineHeightRatio,
              ).lineCount <= Math.max(1, maxLines);
          if (fits) {
            best = candidate;
            low = candidate + 1;
          } else {
            high = candidate - 1;
          }
        }

        // Font loading and browser shaping can differ slightly from the canvas
        // metrics Pretext receives. Preserve the Pretext result, then apply one
        // rendered-width correction so a declared single line never creates
        // horizontal overflow at a narrow breakpoint.
        if (maxLines === 1) {
          const previousInlineSize = node.style.fontSize;
          node.style.fontSize = `${best}px`;
          const renderedWidth = node.scrollWidth;
          node.style.fontSize = previousInlineSize;
          if (renderedWidth > width + 0.5) {
            best = Math.max(
              minFontSize,
              Math.floor(best * (width / renderedWidth)),
            );
          }
        }
        setFontSize((current) => (current === best ? current : best));
      });
    };

    const observer = new ResizeObserver(([entry]) => {
      fit(entry?.contentRect.width ?? node.getBoundingClientRect().width);
    });
    observer.observe(node);
    void document.fonts?.ready.then(() => {
      if (!disposed) fit(node.getBoundingClientRect().width);
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [children, maxFontSize, maxLines, minFontSize]);

  const mergedStyle: CSSProperties = {
    ...style,
    ...(maxLines === 1 ? { whiteSpace: "nowrap" } : null),
    ...(fontSize ? { fontSize: `${fontSize}px` } : null),
  };

  return (
    <Component
      {...props}
      ref={ref}
      className={["fit-text", className].filter(Boolean).join(" ")}
      data-fit-lines={maxLines}
      data-fit-ready={fontSize === null ? "false" : "true"}
      style={mergedStyle}
    >
      {children}
    </Component>
  );
}
