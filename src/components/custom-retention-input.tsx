"use client";

import { useId, useState } from "react";
import { CustomSelect } from "./custom-select";

export const CUSTOM_RETENTION_OPTION = "Custom policy";

export type RetentionUnit = "days" | "months" | "years";

const retentionUnitOptions = [
  { label: "Days", value: "days" },
  { label: "Months", value: "months" },
  { label: "Years", value: "years" },
] as const;

const customRetentionPattern = /^(\d+)\s+(day|days|month|months|year|years)$/i;

export function parseCustomRetention(value: string): {
  quantity: string;
  unit: RetentionUnit;
} | null {
  const match = customRetentionPattern.exec(value.trim());
  if (!match) return null;

  const rawUnit = match[2].toLowerCase();
  const unit: RetentionUnit = rawUnit.startsWith("day")
    ? "days"
    : rawUnit.startsWith("month")
      ? "months"
      : "years";

  return { quantity: match[1], unit };
}

export function formatCustomRetention(
  quantity: string,
  unit: RetentionUnit,
): string {
  if (!quantity) return "";
  const normalizedUnit = quantity === "1" ? unit.slice(0, -1) : unit;
  return `${quantity} ${normalizedUnit}`;
}

export function isValidCustomRetention(value: string): boolean {
  const parsed = parseCustomRetention(value);
  return parsed !== null && Number(parsed.quantity) > 0;
}

export function initialRetentionSelection(retentionDays: number): {
  option: string;
  customValue: string;
} {
  if (retentionDays === 90 || retentionDays === 365) {
    return { option: `${retentionDays} days`, customValue: "" };
  }

  return {
    option: CUSTOM_RETENTION_OPTION,
    customValue: `${retentionDays} days`,
  };
}

export function CustomRetentionInput({
  open,
  value,
  onValueChange,
}: {
  open: boolean;
  value: string;
  onValueChange: (value: string) => void;
}) {
  const hasValue = value.trim().length > 0;
  const invalid = hasValue && !isValidCustomRetention(value);
  const parsedValue = parseCustomRetention(value);
  const [unit, setUnit] = useState<RetentionUnit>(parsedValue?.unit ?? "days");
  const quantity = parsedValue?.quantity ?? "";
  const fieldLabelId = useId();
  const descriptionId = useId();

  function updateQuantity(nextQuantity: string) {
    if (nextQuantity !== "" && !/^\d+$/.test(nextQuantity)) return;
    onValueChange(formatCustomRetention(nextQuantity, unit));
  }

  function updateUnit(nextUnit: string) {
    const normalizedUnit = nextUnit as RetentionUnit;
    setUnit(normalizedUnit);
    onValueChange(formatCustomRetention(quantity, normalizedUnit));
  }

  return (
    <div
      className="custom-retention-region"
      data-open={open ? "true" : "false"}
      aria-hidden={!open}
    >
      <div className="custom-retention-region-inner">
        <div className="custom-retention-field">
          <span id={fieldLabelId}>Custom retention period</span>
          <div
            className="custom-retention-control"
            role="group"
            aria-labelledby={fieldLabelId}
          >
            <label className="custom-retention-number">
              <span className="sr-only">Retention amount</span>
              <input
                type="number"
                inputMode="numeric"
                autoComplete="off"
                min="1"
                step="1"
                value={quantity}
                placeholder="Enter a number"
                aria-describedby={descriptionId}
                aria-invalid={invalid || undefined}
                required={open}
                tabIndex={open ? 0 : -1}
                onChange={(event) => updateQuantity(event.target.value)}
                onKeyDown={(event) => {
                  if (["e", "E", "+", "-", ".", ","].includes(event.key)) {
                    event.preventDefault();
                  }
                }}
              />
            </label>
            <CustomSelect
              ariaLabel="Retention unit"
              className="custom-retention-unit-select"
              disabled={!open}
              options={retentionUnitOptions}
              value={unit}
              onValueChange={updateUnit}
            />
          </div>
          <small
            id={descriptionId}
            className={invalid ? "custom-retention-error" : "subtle"}
          >
            {invalid
              ? "Enter a whole number greater than zero."
              : "Choose a whole number and whether it represents days, months, or years."}
          </small>
        </div>
      </div>
    </div>
  );
}
