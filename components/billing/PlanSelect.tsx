"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { CommercialPlanKey } from "@/lib/billing/planCatalog";
import { PLAN_ORDER } from "@/lib/billing/planCatalog";

export type PlanSelectMode = "signup" | "initial_checkout" | "subscriber";

export type PlanSelectOption = {
  key: CommercialPlanKey;
  name: string;
  description?: string;
  /** Preço principal já formatado (ex.: "R$ 349,00/mês"). */
  priceLabel: string;
  /** Linha secundária (promo, anual à vista, "Plano atual"). */
  secondaryLabel?: string | null;
  popular?: boolean;
  disabled?: boolean;
};

const triggerVariants = cva(
  "h-auto min-h-11 w-full gap-2 py-2.5 text-left [&>span]:line-clamp-none [&>span]:w-full",
  {
    variants: {
      tone: {
        default: "",
        brand:
          "border-emerald-600/40 focus:ring-emerald-600/30 dark:border-emerald-500/40",
      },
    },
    defaultVariants: { tone: "default" },
  }
);

export type PlanSelectProps = {
  mode: PlanSelectMode;
  value: CommercialPlanKey | null;
  onValueChange: (key: CommercialPlanKey) => void;
  options: PlanSelectOption[];
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
  "aria-label"?: string;
} & VariantProps<typeof triggerVariants>;

function sortOptions(options: PlanSelectOption[]): PlanSelectOption[] {
  const rank = new Map(PLAN_ORDER.map((k, i) => [k, i]));
  return [...options].sort(
    (a, b) => (rank.get(a.key) ?? 99) - (rank.get(b.key) ?? 99)
  );
}

function OptionRows({ opt }: { opt: PlanSelectOption }) {
  return (
    <span className="flex w-full min-w-0 flex-col gap-0.5 pr-1">
      <span className="flex items-center justify-between gap-3">
        <span className="truncate font-semibold">
          {opt.name}
          {opt.popular ? (
            <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-violet-600">
              Popular
            </span>
          ) : null}
        </span>
        <span className="shrink-0 font-semibold tabular-nums">{opt.priceLabel}</span>
      </span>
      {opt.secondaryLabel ? (
        <span className="truncate text-xs text-foreground-muted">{opt.secondaryLabel}</span>
      ) : opt.description ? (
        <span className="line-clamp-2 text-xs text-foreground-muted">{opt.description}</span>
      ) : null}
    </span>
  );
}

/**
 * Select canônico Essencial | Pro | Market (Radix Select + CVA).
 * Só UI — preço/promo/ciclo vêm do parent; mutação fica nas APIs.
 */
export const PlanSelect = React.forwardRef<
  React.ElementRef<typeof SelectTrigger>,
  PlanSelectProps
>(function PlanSelect(
  {
    mode,
    value,
    onValueChange,
    options,
    disabled = false,
    loading = false,
    placeholder = "Escolha um plano",
    className,
    tone,
    id,
    "aria-label": ariaLabel = "Plano do SaaS",
  },
  ref
) {
  const sorted = sortOptions(options);
  const selected = value ? sorted.find((o) => o.key === value) : undefined;
  const locked = disabled || loading;

  return (
    <Select
      value={value ?? undefined}
      onValueChange={(v) => {
        if (v === "essencial" || v === "pro" || v === "market") {
          onValueChange(v);
        }
      }}
      disabled={locked}
    >
      <SelectTrigger
        ref={ref}
        id={id}
        aria-label={ariaLabel}
        data-mode={mode}
        className={cn(triggerVariants({ tone }), className)}
      >
        {loading ? (
          <span className="flex items-center gap-2 text-foreground-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Preparando…
          </span>
        ) : (
          <>
            {selected ? <OptionRows opt={selected} /> : null}
            <SelectValue
              placeholder={placeholder}
              className={selected ? "sr-only" : undefined}
            />
          </>
        )}
      </SelectTrigger>
      <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
        {sorted.map((opt) => (
          <SelectItem
            key={opt.key}
            value={opt.key}
            disabled={opt.disabled}
            className="items-start py-2.5"
            textValue={`${opt.name} ${opt.priceLabel}`}
          >
            <OptionRows opt={opt} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
});

PlanSelect.displayName = "PlanSelect";
