"use client";

import * as React from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { toggleVariants } from "@/components/ui/toggle";

const toggleGroupVariants = cva("flex items-center justify-center rounded-lg", {
    variants: {
        variant: {
            default: "bg-transparent",
            outline: "bg-zinc-100 p-0.5 dark:bg-zinc-800",
        },
        spacing: {
            none: "gap-0",
            sm: "gap-0.5",
        },
    },
    defaultVariants: {
        variant: "outline",
        spacing: "sm",
    },
});

const ToggleGroupContext = React.createContext<VariantProps<typeof toggleVariants>>({
    size: "sm",
    variant: "default",
});

export type ToggleGroupProps = React.ComponentPropsWithoutRef<
    typeof ToggleGroupPrimitive.Root
> &
    VariantProps<typeof toggleGroupVariants> &
    VariantProps<typeof toggleVariants>;

const ToggleGroup = React.forwardRef<
    React.ElementRef<typeof ToggleGroupPrimitive.Root>,
    ToggleGroupProps
>(({ className, variant, size, spacing, children, ...props }, ref) => (
    <ToggleGroupPrimitive.Root
        ref={ref}
        className={cn(toggleGroupVariants({ variant, spacing }), className)}
        {...props}
    >
        <ToggleGroupContext.Provider value={{ variant, size }}>
            {children}
        </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
));
ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName;

export type ToggleGroupItemProps = React.ComponentPropsWithoutRef<
    typeof ToggleGroupPrimitive.Item
> &
    VariantProps<typeof toggleVariants>;

const ToggleGroupItem = React.forwardRef<
    React.ElementRef<typeof ToggleGroupPrimitive.Item>,
    ToggleGroupItemProps
>(({ className, variant, size, ...props }, ref) => {
    const ctx = React.useContext(ToggleGroupContext);
    return (
        <ToggleGroupPrimitive.Item
            ref={ref}
            className={cn(
                toggleVariants({
                    variant: ctx.variant ?? variant,
                    size: ctx.size ?? size,
                }),
                className
            )}
            {...props}
        />
    );
});
ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName;

export { ToggleGroup, ToggleGroupItem, toggleGroupVariants };
