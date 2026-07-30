"use client";

import { Check, ChevronDown } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

type CustomSelectProps = {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  leadingIcon?: ReactNode;
  name?: string;
  onValueChange: (value: string) => void;
  options: readonly (string | { label: string; value: string })[];
  value: string;
};

export function CustomSelect({
  ariaLabel,
  className = "",
  disabled = false,
  leadingIcon,
  name,
  onValueChange,
  options,
  value,
}: CustomSelectProps) {
  const normalizedOptions = options.map((option) =>
    typeof option === "string" ? { label: option, value: option } : option,
  );
  const selectedIndex = Math.max(
    0,
    normalizedOptions.findIndex((option) => option.value === value),
  );
  const selectedOption = normalizedOptions[selectedIndex];
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(selectedIndex);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[highlightedIndex]?.focus();
  }, [highlightedIndex, open]);

  function openAt(index: number) {
    if (disabled || normalizedOptions.length === 0) return;
    setHighlightedIndex(
      Math.min(Math.max(index, 0), normalizedOptions.length - 1),
    );
    setOpen(true);
  }

  function closeAndReturnFocus() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function selectOption(optionValue: string) {
    onValueChange(optionValue);
    closeAndReturnFocus();
  }

  function moveHighlight(nextIndex: number) {
    const wrappedIndex =
      (nextIndex + normalizedOptions.length) % normalizedOptions.length;
    setHighlightedIndex(wrappedIndex);
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openAt(selectedIndex);
    } else if (event.key === "Home") {
      event.preventDefault();
      openAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      openAt(options.length - 1);
    }
  }

  function handleOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveHighlight(highlightedIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(highlightedIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setHighlightedIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setHighlightedIndex(options.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectOption(normalizedOptions[highlightedIndex].value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeAndReturnFocus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className={`custom-select ${className}`.trim()}>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <button
        ref={triggerRef}
        type="button"
        className="custom-select-trigger"
        aria-label={`${ariaLabel}: ${selectedOption?.label ?? value}`}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openAt(selectedIndex))}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="custom-select-value">
          {leadingIcon}
          <span>{selectedOption?.label ?? value}</span>
        </span>
        <ChevronDown aria-hidden="true" size={16} />
      </button>

      {open ? (
        <div
          id={listboxId}
          className="custom-select-menu"
          role="listbox"
          aria-label={ariaLabel}
        >
          {normalizedOptions.map((option, index) => {
            const selected = option.value === value;
            const highlighted = index === highlightedIndex;
            return (
              <button
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                key={option.value}
                type="button"
                role="option"
                className="custom-select-option"
                aria-selected={selected}
                data-highlighted={highlighted ? "true" : undefined}
                tabIndex={highlighted ? 0 : -1}
                onClick={() => selectOption(option.value)}
                onFocus={() => setHighlightedIndex(index)}
                onKeyDown={handleOptionKeyDown}
              >
                <Check aria-hidden="true" size={15} />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
