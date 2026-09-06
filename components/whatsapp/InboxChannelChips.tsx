"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
    parseInboxChannelFilter,
    type InboxChannelFilter,
} from "@/src/domain/messaging/inboxChannelFilter";

type InboxChannelChipsProps = {
    value: InboxChannelFilter;
    onValueChange: (next: InboxChannelFilter) => void;
    showMeta: boolean;
    className?: string;
};

export default function InboxChannelChips({
    value,
    onValueChange,
    showMeta,
    className,
}: InboxChannelChipsProps) {
    const cols = showMeta ? "grid-cols-3" : "grid-cols-2";
    const safeValue = !showMeta && value === "meta" ? "all" : value;

    return (
        <Tabs
            value={safeValue}
            onValueChange={(next) => onValueChange(parseInboxChannelFilter(next))}
            className={className}
        >
            <TabsList
                aria-label="Filtrar conversas por canal"
                className={cn("grid h-auto w-full gap-0.5 p-0.5", cols)}
            >
                <TabsTrigger
                    value="all"
                    className="min-w-0 px-1.5 py-1 text-[11px] leading-tight"
                >
                    Todos
                </TabsTrigger>
                <TabsTrigger
                    value="whatsapp"
                    className="min-w-0 px-1.5 py-1 text-[11px] leading-tight"
                >
                    WhatsApp
                </TabsTrigger>
                {showMeta ? (
                    <TabsTrigger
                        value="meta"
                        className="min-w-0 truncate px-1.5 py-1 text-[11px] leading-tight"
                    >
                        IG / Messenger
                    </TabsTrigger>
                ) : null}
            </TabsList>
        </Tabs>
    );
}
