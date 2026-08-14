"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { isoDate } from "../lib/format";
import type { DateRange } from "../lib/types";

export type Period = "today" | "7d" | "15d" | "30d" | "custom";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function useFinancePeriod() {
    const searchParams = useSearchParams();
    const [period, setPeriod] = useState<Period>("30d");
    const [customFrom, setCustomFrom] = useState("");
    const [customTo, setCustomTo] = useState("");
    const [urlPeriodApplied, setUrlPeriodApplied] = useState(false);

    useEffect(() => {
        if (urlPeriodApplied) return;
        const from = searchParams.get("from");
        const to = searchParams.get("to");
        if (from && to && ISO.test(from) && ISO.test(to) && from <= to) {
            setPeriod("custom");
            setCustomFrom(from);
            setCustomTo(to);
        }
        setUrlPeriodApplied(true);
    }, [searchParams, urlPeriodApplied]);

    const dateRange: DateRange = useMemo(() => {
        const now = new Date();
        const today = isoDate(now);
        if (period === "today") return { from: today, to: today, days: 1 };
        if (period === "7d") return { from: isoDate(new Date(Date.now() - 6 * 86400000)), to: today, days: 7 };
        if (period === "15d") return { from: isoDate(new Date(Date.now() - 14 * 86400000)), to: today, days: 15 };
        if (period === "30d") return { from: isoDate(new Date(Date.now() - 29 * 86400000)), to: today, days: 30 };
        if (period === "custom" && customFrom && customTo) {
            const diff =
                Math.round((new Date(customTo).getTime() - new Date(customFrom).getTime()) / 86400000) + 1;
            return { from: customFrom, to: customTo, days: Math.max(diff, 1) };
        }
        return { from: isoDate(new Date(Date.now() - 29 * 86400000)), to: today, days: 30 };
    }, [period, customFrom, customTo]);

    const periodLabel = { today: "Hoje", "7d": "7d", "15d": "15d", "30d": "30d", custom: "Personalizado" }[
        period
    ];

    return {
        period,
        setPeriod,
        customFrom,
        setCustomFrom,
        customTo,
        setCustomTo,
        dateRange,
        periodLabel,
    };
}
