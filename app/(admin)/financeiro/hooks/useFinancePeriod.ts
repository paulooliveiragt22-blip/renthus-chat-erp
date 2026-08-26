"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { isoDate } from "../lib/format";
import type { DateRange } from "../lib/types";

export type Period = "today" | "7d" | "15d" | "30d" | "all" | "custom";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Início seguro para "todo o período" (pré-prod / histórico curto). */
const ALL_FROM = "2020-01-01";

function daysBetween(from: string, to: string): number {
    const a = new Date(from + "T12:00:00Z").getTime();
    const b = new Date(to + "T12:00:00Z").getTime();
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 1;
    return Math.round((b - a) / 86400000) + 1;
}

function defaultCustomRange(): { from: string; to: string } {
    const to = isoDate(new Date());
    const from = isoDate(new Date(Date.now() - 29 * 86400000));
    return { from, to };
}

export function useFinancePeriod() {
    const searchParams = useSearchParams();
    const [period, setPeriodState] = useState<Period>("30d");
    const [customFrom, setCustomFrom] = useState("");
    const [customTo, setCustomTo] = useState("");
    const [urlPeriodApplied, setUrlPeriodApplied] = useState(false);

    useEffect(() => {
        if (urlPeriodApplied) return;
        const from = searchParams.get("from");
        const to = searchParams.get("to");
        if (from && to && ISO.test(from) && ISO.test(to) && from <= to) {
            setPeriodState("custom");
            setCustomFrom(from);
            setCustomTo(to);
        }
        setUrlPeriodApplied(true);
    }, [searchParams, urlPeriodApplied]);

    const setPeriod = useCallback((p: Period) => {
        setPeriodState(p);
        if (p === "custom") {
            setCustomFrom((prev) => {
                if (prev && ISO.test(prev)) return prev;
                return defaultCustomRange().from;
            });
            setCustomTo((prev) => {
                if (prev && ISO.test(prev)) return prev;
                return defaultCustomRange().to;
            });
        }
    }, []);

    const dateRange: DateRange = useMemo(() => {
        const today = isoDate(new Date());
        if (period === "today") return { from: today, to: today, days: 1 };
        if (period === "7d") {
            const from = isoDate(new Date(Date.now() - 6 * 86400000));
            return { from, to: today, days: 7 };
        }
        if (period === "15d") {
            const from = isoDate(new Date(Date.now() - 14 * 86400000));
            return { from, to: today, days: 15 };
        }
        if (period === "30d") {
            const from = isoDate(new Date(Date.now() - 29 * 86400000));
            return { from, to: today, days: 30 };
        }
        if (period === "all") {
            return { from: ALL_FROM, to: today, days: daysBetween(ALL_FROM, today) };
        }
        if (period === "custom" && ISO.test(customFrom) && ISO.test(customTo) && customFrom <= customTo) {
            return {
                from: customFrom,
                to: customTo,
                days: daysBetween(customFrom, customTo),
            };
        }
        // Personalizado incompleto / inválido: mantém 30d até as duas datas válidas.
        const fallback = defaultCustomRange();
        return { from: fallback.from, to: fallback.to, days: 30 };
    }, [period, customFrom, customTo]);

    const periodLabel =
        {
            today: "Hoje",
            "7d": "7d",
            "15d": "15d",
            "30d": "30d",
            all: "Todo o período",
            custom:
                ISO.test(customFrom) && ISO.test(customTo)
                    ? `${customFrom} → ${customTo}`
                    : "Personalizado",
        }[period] ?? "Período";

    const customInvalid =
        period === "custom" &&
        Boolean(customFrom || customTo) &&
        !(ISO.test(customFrom) && ISO.test(customTo) && customFrom <= customTo);

    return {
        period,
        setPeriod,
        customFrom,
        setCustomFrom,
        customTo,
        setCustomTo,
        dateRange,
        periodLabel,
        customInvalid,
    };
}
