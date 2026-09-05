import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const emptyStateVariants = cva(
  "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
  {
    variants: {
      tone: {
        default: "text-foreground-muted",
        soft: "rounded-xl border border-dashed border-border bg-zinc-50/80 dark:bg-zinc-900/40",
      },
    },
    defaultVariants: { tone: "soft" },
  }
);

export type EmptyStateProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof emptyStateVariants> & {
    icon?: React.ReactNode;
    title: string;
    description?: string;
    actionLabel?: string;
    onAction?: () => void;
    actionHref?: string;
  };

function EmptyState({
  className,
  tone,
  icon,
  title,
  description,
  actionLabel,
  onAction,
  actionHref,
  ...props
}: EmptyStateProps) {
  return (
    <div className={cn(emptyStateVariants({ tone }), className)} {...props}>
      {icon ? (
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          {icon}
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-xs leading-relaxed text-foreground-muted">
            {description}
          </p>
        ) : null}
      </div>
      {actionLabel && (onAction || actionHref) ? (
        actionHref ? (
          <Button asChild size="sm" variant="default">
            <a href={actionHref}>{actionLabel}</a>
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={onAction}>
            {actionLabel}
          </Button>
        )
      ) : null}
    </div>
  );
}

export { EmptyState, emptyStateVariants };
