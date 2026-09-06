"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
    parseInboxChannelFilter,
    type InboxChannelFilter,
} from "@/src/domain/messaging/inboxChannelFilter";

const inboxChannelGroupVariants = cva("grid w-full", {
    variants: {
        columns: {
            two: "grid-cols-2",
            three: "grid-cols-3",
        },
    },
    defaultVariants: {
        columns: "two",
    },
});

export type InboxChannelChipsProps = Omit<
    React.ComponentPropsWithoutRef<typeof ToggleGroup>,
    "type" | "value" | "defaultValue" | "onValueChange"
> &
    VariantProps<typeof inboxChannelGroupVariants> & {
        value: InboxChannelFilter;
        onValueChange: (next: InboxChannelFilter) => void;
        showMeta?: boolean;
    };

const InboxChannelChips = React.forwardRef<
    React.ElementRef<typeof ToggleGroup>,
    InboxChannelChipsProps
>(
    (
        { value, onValueChange, showMeta = false, columns, className, ...props },
        ref
    ) => {
        const resolvedColumns = columns ?? (showMeta ? "three" : "two");
        const safeValue = !showMeta && value === "meta" ? "all" : value;

        return (
            <ToggleGroup
                ref={ref}
                variant="outline"
                size="sm"
                spacing="sm"
                className={cn(
                    inboxChannelGroupVariants({ columns: resolvedColumns }),
                    className
                )}
                aria-label="Filtrar conversas por canal"
                {...props}
                type="single"
                value={safeValue}
                onValueChange={(next) => {
                    if (!next) return;
                    onValueChange(parseInboxChannelFilter(next));
                }}
            >
                <ToggleGroupItem value="all" className="min-w-0 truncate">
                    Todos
                </ToggleGroupItem>
                <ToggleGroupItem value="whatsapp" className="min-w-0 truncate">
                    WhatsApp
                </ToggleGroupItem>
                {showMeta ? (
                    <ToggleGroupItem value="meta" className="min-w-0 truncate">
                        IG / Messenger
                    </ToggleGroupItem>
                ) : null}
            </ToggleGroup>
        );
    }
);
InboxChannelChips.displayName = "InboxChannelChips";

export { InboxChannelChips, inboxChannelGroupVariants };
export default InboxChannelChips;
