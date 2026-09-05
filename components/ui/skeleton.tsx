import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const skeletonVariants = cva("animate-pulse bg-zinc-200 dark:bg-zinc-700", {
  variants: {
    rounded: {
      default: "rounded-lg",
      full: "rounded-full",
      none: "rounded-none",
      md: "rounded-md",
    },
  },
  defaultVariants: { rounded: "default" },
});

export type SkeletonProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof skeletonVariants>;

/**
 * Placeholder de loading canônico (ADR-0009 / Onda A).
 * Preferir shape da UI final (h/w) em vez de spinner full-page.
 */
function Skeleton({ className, rounded, ...props }: SkeletonProps) {
  return (
    <div
      className={cn(skeletonVariants({ rounded }), className)}
      aria-hidden
      {...props}
    />
  );
}

export { Skeleton, skeletonVariants };
