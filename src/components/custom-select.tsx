"use client";

import { Check, ChevronDown } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

type CustomSelectProps = {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  inlineMenu?: boolean;
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
  inlineMenu = false,
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
  const [menuPlacement, setMenuPlacement] = useState<"top" | "bottom">(
    "bottom",
  );
  const [menuAlignment, setMenuAlignment] = useState<"start" | "end">("end");
  const [menuMaxHeight, setMenuMaxHeight] = useState(320);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
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

  useLayoutEffect(() => {
    if (!open || inlineMenu) return;

    let frame = 0;
    const positionMenu = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const trigger = triggerRef.current;
        const menuElement = menuRef.current;
        if (!trigger || !menuElement) return;

        const viewportPadding = 12;
        const menuGap = 8;
        const triggerRect = trigger.getBoundingClientRect();
        const spaceBelow = Math.max(
          0,
          window.innerHeight - triggerRect.bottom - menuGap - viewportPadding,
        );
        const spaceAbove = Math.max(
          0,
          triggerRect.top - menuGap - viewportPadding,
        );
        const desiredHeight = Math.min(
          menuElement.scrollHeight,
          320,
          window.innerHeight * 0.6,
        );
        const nextPlacement =
          spaceBelow < desiredHeight && spaceAbove > spaceBelow
            ? "top"
            : "bottom";
        const availableHeight =
          nextPlacement === "top" ? spaceAbove : spaceBelow;
        const estimatedWidth = Math.max(triggerRect.width, 190);

        setMenuPlacement(nextPlacement);
        setMenuAlignment(
          triggerRect.right - estimatedWidth < viewportPadding ? "start" : "end",
        );
        setMenuMaxHeight(Math.max(96, Math.min(320, availableHeight)));
      });
    };

    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [inlineMenu, open]);

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
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
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

  const menu = (
    <div
      ref={menuRef}
      id={listboxId}
      className="custom-select-menu"
      role="listbox"
      aria-label={ariaLabel}
      aria-hidden={!open}
      data-open={open ? "true" : "false"}
      data-placement={menuPlacement}
      data-alignment={menuAlignment}
      style={inlineMenu ? undefined : { maxHeight: `${menuMaxHeight}px` }}
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
            tabIndex={open && highlighted ? 0 : -1}
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
  );

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

      {inlineMenu ? (
        <div
          className="custom-select-inline-region"
          data-open={open ? "true" : "false"}
          aria-hidden={!open}
        >
          {menu}
        </div>
      ) : (
        menu
      )}
    </div>
  );
}
