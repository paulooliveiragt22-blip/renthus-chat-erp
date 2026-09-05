"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { PLAN_TOGGLE_ACCENT } from "@/lib/billing/planOfferUi";

export type BillingPeriodValue = "month" | "year";

const wrapVariants = cva("inline-flex items-center gap-3", {
  variants: {
    size: {
      sm: "text-xs",
      md: "text-sm",
    },
  },
  defaultVariants: { size: "md" },
});

const labelVariants = cva("font-semibold transition-colors", {
  variants: {
    active: {
      true: "text-zinc-900 dark:text-zinc-50",
      false: "text-zinc-400 dark:text-zinc-500",
    },
  },
  defaultVariants: { active: false },
});

export type BillingPeriodToggleProps = {
  value: BillingPeriodValue;
  onValueChange: (next: BillingPeriodValue) => void;
  /** Ex.: "economize até 20%" ao lado de Anual. */
  yearlyHint?: string | null;
  disabled?: boolean;
  id?: string;
  className?: string;
} & VariantProps<typeof wrapVariants>;

/**
 * Toggle Mensal ↔ Anual via Radix Switch.
 * checked = year; unchecked = month.
 */
export function BillingPeriodToggle({
  value,
  onValueChange,
  yearlyHint,
  disabled = false,
  id = "billing-period",
  size,
  className,
}: BillingPeriodToggleProps) {
  const isYear = value === "year";

  return (
    <div
      className={cn(wrapVariants({ size }), className)}
      role="group"
      aria-label="Ciclo de cobrança"
    >
      <span className={cn(labelVariants({ active: !isYear }))} id={`${id}-month`}>
        Mensal
      </span>
      <Switch
        id={id}
        checked={isYear}
        disabled={disabled}
        aria-labelledby={`${id}-month ${id}-year`}
        onCheckedChange={(checked) => onValueChange(checked ? "year" : "month")}
        className="data-[state=checked]:bg-[color:var(--plan-toggle-accent)]"
        style={
          {
            "--plan-toggle-accent": PLAN_TOGGLE_ACCENT,
          } as React.CSSProperties
        }
      />
      <span className={cn(labelVariants({ active: isYear }), "inline-flex items-center gap-1.5")}>
        <span id={`${id}-year`}>Anual</span>
        {yearlyHint ? (
          <span
            className="text-[10px] font-bold"
            style={{ color: isYear ? "#16364D" : PLAN_TOGGLE_ACCENT, opacity: 0.9 }}
          >
            {yearlyHint}
          </span>
        ) : null}
      </span>
    </div>
  );
}
