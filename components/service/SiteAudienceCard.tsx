"use client";

import { useEffect, useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { parseSiteAudienceDays, type SiteAudienceDays } from "@/src/service/domain/siteAudience";

const PERIODS: { value: SiteAudienceDays; label: string }[] = [
    { value: 1, label: "Hoje" },
    { value: 7, label: "7 dias" },
    { value: 30, label: "30 dias" },
];

function countFrom(raw: unknown): number | null {
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

export function SiteAudienceCard() {
    const [days, setDays] = useState<SiteAudienceDays>(1);
    const [visits, setVisits] = useState<number | null>(null);
    const [chats, setChats] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        void (async () => {
            try {
                const res = await fetch(`/api/admin/service/audience?days=${days}`, {
                    credentials: "include",
                    cache: "no-store",
                });
                const json = (await res.json().catch(() => null)) as { ok?: unknown; visits?: unknown; chats?: unknown } | null;
                if (cancelled) return;
                const nextVisits = countFrom(json?.visits);
                const nextChats = countFrom(json?.chats);
                if (!res.ok || json?.ok !== true || nextVisits === null || nextChats === null) {
                    setError("Não consegui carregar o acesso.");
                    return;
                }
                setVisits(nextVisits);
                setChats(nextChats);
                setError(null);
            } catch {
                if (!cancelled) setError("Não consegui carregar o acesso.");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [days]);

    return (
        <section className="flex flex-col gap-4 rounded-xl border border-zinc-200/80 bg-white p-4 dark:border-zinc-800/80 dark:bg-zinc-950">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Acesso ao site</h2>
                <ToggleGroup
                    type="single"
                    value={String(days)}
                    variant="outline"
                    spacing="sm"
                    aria-label="Período"
                    onValueChange={(value) => {
                        if (value === "1" || value === "7" || value === "30") setDays(parseSiteAudienceDays(value));
                    }}
                >
                    {PERIODS.map((period) => (
                        <ToggleGroupItem key={period.value} value={String(period.value)} aria-label={period.label}>
                            {period.label}
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>
            </div>
            {loading ? (
                <div className="grid grid-cols-2 gap-3">
                    <Skeleton className="h-16" />
                    <Skeleton className="h-16" />
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-3">
                    <p className="min-w-0">
                        <span className="block truncate text-sm text-zinc-500 dark:text-zinc-400">Pessoas no site</span>
                        <span className="font-mono text-2xl font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">{visits ?? "—"}</span>
                    </p>
                    <p className="min-w-0">
                        <span className="block truncate text-sm text-zinc-500 dark:text-zinc-400">Conversas com a IA</span>
                        <span className="font-mono text-2xl font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">{chats ?? "—"}</span>
                    </p>
                </div>
            )}
            {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Cada navegador conta uma vez no período. A conversa entra quando a pessoa escreve uma pergunta.
            </p>
        </section>
    );
}
