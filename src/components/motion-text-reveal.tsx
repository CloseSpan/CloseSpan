"use client";

import { motion, type Variants, useReducedMotion } from "framer-motion";
import { Fragment, useSyncExternalStore } from "react";

type MotionTextRevealProps = {
  className?: string;
  highlight?: string;
  text: string;
};

const CONTAINER_VARIANTS: Variants = {
  hidden: {},
  visible: {
    transition: {
      delayChildren: 0.06,
      staggerChildren: 0.065,
    },
  },
};

const WORD_VARIANTS: Variants = {
  hidden: {
    filter: "blur(3px)",
    opacity: 0,
    y: "35%",
  },
  visible: {
    filter: "blur(0px)",
    opacity: 1,
    transition: {
      duration: 0.72,
      ease: [0.16, 1, 0.3, 1],
    },
    y: "0%",
  },
};

const subscribeToHydration = () => () => undefined;

function useHydrated() {
  return useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
}

function findHighlightRange(words: string[], highlight?: string) {
  if (!highlight) return { start: -1, end: -1 };
  const highlightedWords = highlight.trim().split(/\s+/u);
  const start = words.findIndex((_, index) =>
    highlightedWords.every((word, offset) => words[index + offset] === word),
  );
  return {
    start,
    end: start < 0 ? -1 : start + highlightedWords.length,
  };
}

function wordClassName(index: number, start: number, end: number) {
  return [
    "motion-text-reveal-word",
    index >= start && index < end ? "motion-text-reveal-accent" : "",
  ].filter(Boolean).join(" ");
}

export function MotionTextReveal({
  className,
  highlight,
  text,
}: MotionTextRevealProps) {
  const hydrated = useHydrated();
  const reduceMotion = useReducedMotion();
  const words = text.trim().split(/\s+/u);
  const { start, end } = findHighlightRange(words, highlight);
  const shouldAnimate = hydrated && reduceMotion !== true;

  return (
    <h1 aria-label={text} className={className} data-motion-text-reveal="true">
      {shouldAnimate ? (
        <motion.span
          animate="visible"
          aria-hidden="true"
          initial="hidden"
          variants={CONTAINER_VARIANTS}
        >
          {words.map((word, index) => (
            <Fragment key={`${word}-${index}`}>
              <span className="motion-text-reveal-mask">
                <motion.span
                  className={wordClassName(index, start, end)}
                  variants={WORD_VARIANTS}
                >
                  {word}
                </motion.span>
              </span>
              {index < words.length - 1 ? " " : null}
            </Fragment>
          ))}
        </motion.span>
      ) : (
        <span aria-hidden="true">
          {words.map((word, index) => (
            <Fragment key={`${word}-${index}`}>
              <span className={wordClassName(index, start, end)}>{word}</span>
              {index < words.length - 1 ? " " : null}
            </Fragment>
          ))}
        </span>
      )}
    </h1>
  );
}
