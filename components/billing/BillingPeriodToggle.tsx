"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { PLAN_TOGGLE_ACCENT } from "@/lib/billing/planOfferUi";

export type BillingPeriodValue = "month" | "year";

const listVariants = cva("inline-flex rounded-full border p-1", {
  variants: {
    appearance: {
      light:
        "border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800",
      onDark: "border-white/15 bg-white/10",
    },
    size: {
      sm: "gap-0.5",
      md: "gap-1",
    },
  },
  defaultVariants: { appearance: "light", size: "md" },
});

const tabVariants = cva(
  "inline-flex items-center justify-center rounded-full font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      appearance: {
        light: "focus-visible:ring-[#57ff8f]/50",
        onDark: "focus-visible:ring-[#57ff8f]/60",
      },
      size: {
        sm: "px-3 py-1 text-xs",
        md: "px-4 py-1.5 text-sm",
      },
      selected: {
        true: "bg-[#57ff8f] text-[#16364D] shadow-sm",
        false: "",
      },
    },
    compoundVariants: [
      {
        appearance: "light",
        selected: false,
        class: "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300",
      },
      {
        appearance: "onDark",
        selected: false,
        class: "text-white/70 hover:text-white",
      },
    ],
    defaultVariants: { appearance: "light", size: "md", selected: false },
  }
);

export type BillingPeriodToggleProps = {
  value: BillingPeriodValue;
  onValueChange: (next: BillingPeriodValue) => void;
  /** Ex.: "economize até 20%" no tab Anual. */
  yearlyHint?: string | null;
  disabled?: boolean;
  id?: string;
  className?: string;
} & VariantProps<typeof listVariants>;

/**
 * Toggle Mensal | Anual — segmented tabs (não Switch booleano).
 * Domínio é month|year; tabs deixam as duas opções explícitas.
 */
export function BillingPeriodToggle({
  value,
  onValueChange,
  yearlyHint,
  disabled = false,
  id = "billing-period",
  appearance,
  size,
  className,
}: BillingPeriodToggleProps) {
  const tabs: BillingPeriodValue[] = ["month", "year"];

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const idx = tabs.indexOf(value);
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      onValueChange(tabs[(idx + 1) % tabs.length]!);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      onValueChange(tabs[(idx - 1 + tabs.length) % tabs.length]!);
    } else if (e.key === "Home") {
      e.preventDefault();
      onValueChange("month");
    } else if (e.key === "End") {
      e.preventDefault();
      onValueChange("year");
    }
  }

  return (
    <div
      id={id}
      role="tablist"
      aria-label="Ciclo de cobrança"
      className={cn(listVariants({ appearance, size }), className)}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        role="tab"
        id={`${id}-month`}
        aria-selected={value === "month"}
        tabIndex={value === "month" ? 0 : -1}
        disabled={disabled}
        onClick={() => onValueChange("month")}
        className={cn(
          tabVariants({ appearance, size, selected: value === "month" })
        )}
      >
        Mensal
      </button>
      <button
        type="button"
        role="tab"
        id={`${id}-year`}
        aria-selected={value === "year"}
        tabIndex={value === "year" ? 0 : -1}
        disabled={disabled}
        onClick={() => onValueChange("year")}
        className={cn(
          tabVariants({ appearance, size, selected: value === "year" })
        )}
      >
        Anual
        {yearlyHint ? (
          <span
            className="ml-1 text-[10px] font-bold"
            style={{
              color: value === "year" ? "#16364D" : PLAN_TOGGLE_ACCENT,
              opacity: 0.85,
            }}
          >
            {yearlyHint}
          </span>
        ) : null}
      </button>
    </div>
  );
}
