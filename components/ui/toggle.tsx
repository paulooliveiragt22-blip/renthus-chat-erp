"use client";

import * as React from "react";
import * as TogglePrimitive from "@radix-ui/react-toggle";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const toggleVariants = cva(
    "inline-flex items-center justify-center gap-1 rounded-md text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-background-card data-[state=on]:text-foreground data-[state=on]:shadow-sm",
    {
        variants: {
            variant: {
                default:
                    "bg-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300",
                outline: "border border-transparent",
            },
            size: {
                sm: "min-h-7 px-1.5 py-1",
                md: "min-h-8 px-2.5 py-1.5",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "sm",
        },
    }
);

export interface ToggleProps
    extends React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root>,
        VariantProps<typeof toggleVariants> {}

const Toggle = React.forwardRef<
    React.ElementRef<typeof TogglePrimitive.Root>,
    ToggleProps
>(({ className, variant, size, ...props }, ref) => (
    <TogglePrimitive.Root
        ref={ref}
        className={cn(toggleVariants({ variant, size }), className)}
        {...props}
    />
));
Toggle.displayName = TogglePrimitive.Root.displayName;

export { Toggle, toggleVariants };
