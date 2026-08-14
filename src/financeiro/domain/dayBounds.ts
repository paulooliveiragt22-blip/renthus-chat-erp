/**
 * Limites de dia civil no fuso da loja (M7).
 * Não usar offset fixo UTC−3.
 */

import { normalizeTimezone, DEFAULT_STORE_TIMEZONE } from "@/lib/delivery/hours";

function pad2(n: number): string {
    return String(n).padStart(2, "0");
}

/** YYYY-MM-DD no fuso informado. */
export function zonedIsoDate(date: Date, timeZone: string): string {
    const tz = normalizeTimezone(timeZone);
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    if (!y || !m || !d) {
        return date.toISOString().slice(0, 10);
    }
    return `${y}-${m}-${d}`;
}

/** Hora 0–23 no fuso informado. */
export function zonedHour(date: Date, timeZone: string): number {
    const tz = normalizeTimezone(timeZone);
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour: "2-digit",
        hourCycle: "h23",
    }).formatToParts(date);
    return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
}

/**
 * Converte data civil + horário local no fuso → instante UTC.
 * Usa varredura curta (evita libs extras).
 */
export function zonedLocalToUtc(
    isoDate: string,
    hour: number,
    minute: number,
    second: number,
    timeZone: string
): Date {
    const tz = normalizeTimezone(timeZone);
    const [ys, ms, ds] = isoDate.split("-");
    const y = Number(ys);
    const mo = Number(ms);
    const d = Number(ds);
    if (!y || !mo || !d) return new Date(NaN);

    // Chute: interpreta como UTC e corrige pelo offset observado
    let guess = Date.UTC(y, mo - 1, d, hour, minute, second, 0);
    for (let i = 0; i < 3; i++) {
        const asLocal = zonedParts(new Date(guess), tz);
        const wantedMin = hour * 60 + minute;
        const gotMin = asLocal.hour * 60 + asLocal.minute;
        const dayDiff =
            Date.UTC(y, mo - 1, d) - Date.UTC(asLocal.year, asLocal.month - 1, asLocal.day);
        const dayMinutes = dayDiff / 60000;
        const deltaMin = dayMinutes + (wantedMin - gotMin);
        if (Math.abs(deltaMin) < 0.05 && asLocal.second === second) break;
        guess += deltaMin * 60_000 + (second - asLocal.second) * 1000;
    }
    return new Date(guess);
}

function zonedParts(date: Date, timeZone: string) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
    }).formatToParts(date);
    const num = (t: Intl.DateTimeFormatPartTypes) =>
        Number(parts.find((p) => p.type === t)?.value ?? "0");
    return {
        year: num("year"),
        month: num("month"),
        day: num("day"),
        hour: num("hour"),
        minute: num("minute"),
        second: num("second"),
    };
}

/** [start, endExclusive) do dia civil YYYY-MM-DD no fuso. */
export function zonedDayRange(isoDate: string, timeZone: string): { start: Date; endExclusive: Date } {
    const tz = normalizeTimezone(timeZone);
    const start = zonedLocalToUtc(isoDate, 0, 0, 0, tz);
    const [y, m, d] = isoDate.split("-").map(Number);
    const next = new Date(Date.UTC(y!, m! - 1, d! + 1));
    const nextIso = `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
    // next calendar day in civil sense — add 1 day via local parts
    const startParts = zonedParts(start, tz);
    const nextLocal = new Date(Date.UTC(startParts.year, startParts.month - 1, startParts.day + 1));
    const nextY = nextLocal.getUTCFullYear();
    const nextM = nextLocal.getUTCMonth() + 1;
    const nextD = nextLocal.getUTCDate();
    const endExclusive = zonedLocalToUtc(
        `${nextY}-${pad2(nextM)}-${pad2(nextD)}`,
        0,
        0,
        0,
        tz
    );
    void nextIso;
    return { start, endExclusive };
}

export function todayIsoInZone(now: Date, timeZone: string): string {
    return zonedIsoDate(now, normalizeTimezone(timeZone) || DEFAULT_STORE_TIMEZONE);
}
