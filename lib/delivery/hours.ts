/**
 * Horário de atendimento canônico (M2).
 * Fonte: `company_settings.opening_periods` (até 2 turnos).
 * `open_time`/`close_time` = 1º turno (compat). Não usar `companies.settings` jsonb nem `business_hours` weekday.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const DEFAULT_STORE_TIMEZONE = "America/Cuiaba";
export const MAX_OPENING_PERIODS = 2;

export const DELIVERY_DESCRIPTION_MAX = 280;

export type OpeningPeriod = {
    openTime: string;
    closeTime: string;
};

export type StoreHours = {
    periods: OpeningPeriod[];
    openTime: string | null;
    closeTime: string | null;
    timeZone: string;
    deliveryDescription: string | null;
};

export const EMPTY_STORE_HOURS: StoreHours = {
    periods: [],
    openTime: null,
    closeTime: null,
    timeZone: DEFAULT_STORE_TIMEZONE,
    deliveryDescription: null,
};

export function parseHhMm(value: string | null | undefined): number | null {
    const match = /^(\d{1,2}):(\d{2})$/u.exec(String(value ?? "").trim());
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
}

/** Normaliza para `HH:MM` ou null. */
export function normalizeHhMm(raw: unknown): string | null {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s) return null;
    const mins = parseHhMm(s);
    if (mins == null) return null;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function normalizeTimezone(raw: unknown): string {
    const tz = String(raw ?? "").trim();
    if (!tz) return DEFAULT_STORE_TIMEZONE;
    try {
        Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
        return tz;
    } catch {
        return DEFAULT_STORE_TIMEZONE;
    }
}

export function sanitizeDeliveryDescription(raw: unknown): string | null {
    if (raw == null) return null;
    const s = String(raw)
        .replaceAll(/\r\n/g, "\n")
        .replaceAll(/[^\S\n]+/g, " ")
        .trim();
    if (!s) return null;
    return s.slice(0, DELIVERY_DESCRIPTION_MAX);
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Aceita `{open,close}` ou `{openTime,closeTime}`. */
export function normalizeOpeningPeriods(raw: unknown): OpeningPeriod[] {
    if (!Array.isArray(raw)) return [];
    const out: OpeningPeriod[] = [];
    for (const item of raw) {
        if (out.length >= MAX_OPENING_PERIODS) break;
        if (!isRecord(item)) continue;
        const open = normalizeHhMm(item.open ?? item.openTime);
        const close = normalizeHhMm(item.close ?? item.closeTime);
        if (!open || !close) continue;
        out.push({ openTime: open, closeTime: close });
    }
    return out;
}

function periodsFromLegacy(openRaw: unknown, closeRaw: unknown): OpeningPeriod[] {
    const open = normalizeHhMm(openRaw);
    const close = normalizeHhMm(closeRaw);
    if (!open || !close) return [];
    return [{ openTime: open, closeTime: close }];
}

export function storeHoursFromRow(row: {
    opening_periods?: unknown;
    open_time?: unknown;
    close_time?: unknown;
    timezone?: unknown;
    delivery_description?: unknown;
} | null): StoreHours {
    if (!row) return { ...EMPTY_STORE_HOURS };
    const fromJson = normalizeOpeningPeriods(row.opening_periods);
    const periods = fromJson.length > 0 ? fromJson : periodsFromLegacy(row.open_time, row.close_time);
    return {
        periods,
        openTime: periods[0]?.openTime ?? null,
        closeTime: periods[periods.length - 1]?.closeTime ?? periods[0]?.closeTime ?? null,
        timeZone: normalizeTimezone(row.timezone),
        deliveryDescription: sanitizeDeliveryDescription(row.delivery_description),
    };
}

export async function loadStoreHours(
    admin: SupabaseClient,
    companyId: string
): Promise<StoreHours> {
    const { data } = await admin
        .from("company_settings")
        .select("opening_periods, open_time, close_time, timezone, delivery_description")
        .eq("company_id", companyId)
        .maybeSingle();
    return storeHoursFromRow(data);
}

function minutesInTimeZone(nowMs: number, timeZone: string): number | null {
    try {
        const parts = new Intl.DateTimeFormat("en-GB", {
            timeZone,
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
        }).formatToParts(new Date(nowMs));
        const hours = Number(parts.find((p) => p.type === "hour")?.value);
        const minutes = Number(parts.find((p) => p.type === "minute")?.value);
        if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
        return hours * 60 + minutes;
    } catch {
        return null;
    }
}

export function isCurrentInPeriod(current: number, open: number, close: number): boolean {
    if (open === close) return true;
    if (close < open) return current >= open || current < close;
    return current >= open && current < close;
}

function periodBounds(p: OpeningPeriod): { open: number; close: number } | null {
    const open = parseHhMm(p.openTime);
    const close = parseHhMm(p.closeTime);
    if (open == null || close == null) return null;
    return { open, close };
}

/**
 * Loja aberta neste instante (pedidos: cardápio + bot).
 * Sem turnos cadastrados → aberto (não inventar fechamento).
 * Timezone inválido → aberto (não bloquear por misconfig).
 */
export function isStoreOpen(nowMs: number, hours: StoreHours | null): boolean {
    const periods = hours?.periods ?? [];
    if (periods.length === 0) return true;

    const timeZone = hours?.timeZone?.trim() || DEFAULT_STORE_TIMEZONE;
    const current = minutesInTimeZone(nowMs, timeZone);
    if (current === null) return true;

    return periods.some((p) => {
        const b = periodBounds(p);
        return b ? isCurrentInPeriod(current, b.open, b.close) : false;
    });
}

/**
 * Janela para mensagens proativas (outbound).
 * Sem horário cadastrado → quiet hours 08:00–22:00 (não madrugada).
 */
export function isWithinProactiveHours(nowMs: number, hours: StoreHours | null): boolean {
    const normalized = hours
        ? storeHoursFromRow({
              opening_periods: hours.periods,
              open_time: hours.openTime,
              close_time: hours.closeTime,
              timezone: hours.timeZone,
          })
        : { ...EMPTY_STORE_HOURS };
    if (normalized.periods.length === 0) {
        return isStoreOpen(nowMs, {
            periods: [{ openTime: "08:00", closeTime: "22:00" }],
            openTime: "08:00",
            closeTime: "22:00",
            timeZone: normalized.timeZone || DEFAULT_STORE_TIMEZONE,
            deliveryDescription: null,
        });
    }
    return isStoreOpen(nowMs, normalized);
}

export function formatHoursLabel(hours: StoreHours): string {
    if (!hours.periods.length) return "";
    return hours.periods.map((p) => `${p.openTime}–${p.closeTime}`).join(" · ");
}

export type NextOpening = { today: boolean; hhmm: string };

/** Próxima abertura no fuso da loja. Null se 24h / sem turno. */
export function nextOpening(nowMs: number, hours: StoreHours): NextOpening | null {
    if (!hours.periods.length) return null;
    const current = minutesInTimeZone(nowMs, hours.timeZone) ?? 0;
    const laterToday: string[] = [];
    for (const p of hours.periods) {
        const b = periodBounds(p);
        if (!b) continue;
        if (isCurrentInPeriod(current, b.open, b.close)) continue;
        if (current < b.open) laterToday.push(p.openTime);
    }
    if (laterToday.length > 0) {
        laterToday.sort();
        return { today: true, hhmm: laterToday[0]! };
    }
    const first = [...hours.periods]
        .map((p) => p.openTime)
        .sort()[0];
    return first ? { today: false, hhmm: first } : null;
}

/** Mensagem PT-BR quando a loja está fechada (não confundir com entregas pausadas). */
export function buildStoreClosedCustomerMessage(hours: StoreHours, nowMs = Date.now()): string {
    const next = nextOpening(nowMs, hours);
    if (next?.today) {
        return `Não estamos atendendo no momento, mas hoje a partir das ${next.hhmm} estamos de volta.`;
    }
    if (next) {
        return `Não estamos atendendo no momento. Voltamos amanhã a partir das ${next.hhmm}.`;
    }
    return "Não estamos atendendo no momento.";
}

export type StoreHoursPublic = {
    openTime: string | null;
    closeTime: string | null;
    timeZone: string;
    deliveryDescription: string | null;
    isOpen: boolean;
    periods: OpeningPeriod[];
    hoursLabel: string;
    closedMessage: string;
};

export function toStoreHoursPublic(hours: StoreHours, nowMs = Date.now()): StoreHoursPublic {
    return {
        openTime: hours.openTime,
        closeTime: hours.closeTime,
        timeZone: hours.timeZone,
        deliveryDescription: hours.deliveryDescription,
        isOpen: isStoreOpen(nowMs, hours),
        periods: hours.periods,
        hoursLabel: formatHoursLabel(hours),
        closedMessage: buildStoreClosedCustomerMessage(hours, nowMs),
    };
}
