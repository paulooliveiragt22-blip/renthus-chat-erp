/**
 * Horário de atendimento canônico (M2).
 * Fonte: `company_settings` — não usar `companies.settings` jsonb nem `business_hours` weekday.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const DEFAULT_STORE_TIMEZONE = "America/Cuiaba";

/** Sem horário cadastrado: evita madrugada (mesmo critério do outbound). */
const DEFAULT_QUIET = { openMinutes: 8 * 60, closeMinutes: 22 * 60 };

export const DELIVERY_DESCRIPTION_MAX = 280;

export type StoreHours = {
    openTime: string | null;
    closeTime: string | null;
    timeZone: string;
    deliveryDescription: string | null;
};

export const EMPTY_STORE_HOURS: StoreHours = {
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
    const tz = String(raw ?? "")
        .trim();
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

export function storeHoursFromRow(row: {
    open_time?: unknown;
    close_time?: unknown;
    timezone?: unknown;
    delivery_description?: unknown;
} | null): StoreHours {
    if (!row) return { ...EMPTY_STORE_HOURS };
    return {
        openTime: normalizeHhMm(row.open_time),
        closeTime: normalizeHhMm(row.close_time),
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
        .select("open_time, close_time, timezone, delivery_description")
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

/**
 * Loja aberta neste instante (pedidos: cardápio + bot).
 * Sem open/close cadastrado → aberto (não inventar fechamento).
 * Timezone inválido → aberto (não bloquear por misconfig).
 * Um dos dois preenchido → o outro cai no quiet hours 08:00/22:00.
 */
export function isStoreOpen(nowMs: number, hours: StoreHours | null): boolean {
    const openConfigured = Boolean(hours?.openTime?.trim());
    const closeConfigured = Boolean(hours?.closeTime?.trim());
    if (!openConfigured && !closeConfigured) return true;

    const timeZone = hours?.timeZone?.trim() || DEFAULT_STORE_TIMEZONE;
    const current = minutesInTimeZone(nowMs, timeZone);
    if (current === null) return true;

    const open = parseHhMm(hours?.openTime) ?? DEFAULT_QUIET.openMinutes;
    const close = parseHhMm(hours?.closeTime) ?? DEFAULT_QUIET.closeMinutes;
    if (open === close) return true;

    if (close < open) return current >= open || current < close;
    return current >= open && current < close;
}

/**
 * Janela para mensagens proativas (outbound).
 * Sem horário cadastrado → quiet hours 08:00–22:00 (não madrugada).
 */
export function isWithinProactiveHours(nowMs: number, hours: StoreHours | null): boolean {
    return isStoreOpen(nowMs, {
        openTime: hours?.openTime?.trim() || "08:00",
        closeTime: hours?.closeTime?.trim() || "22:00",
        timeZone: hours?.timeZone?.trim() || DEFAULT_STORE_TIMEZONE,
        deliveryDescription: null,
    });
}

function formatHhMmLabel(hhmm: string | null, fallbackMinutes: number): string {
    if (hhmm) return hhmm;
    const h = Math.floor(fallbackMinutes / 60);
    const m = fallbackMinutes % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Mensagem PT-BR quando a loja está fechada (não confundir com entregas pausadas). */
export function buildStoreClosedCustomerMessage(hours: StoreHours): string {
    const open = formatHhMmLabel(hours.openTime, DEFAULT_QUIET.openMinutes);
    const close = formatHhMmLabel(hours.closeTime, DEFAULT_QUIET.closeMinutes);
    return (
        `No momento estamos fechados. Nosso horário de atendimento é das ${open} às ${close}. ` +
        `Pode voltar nesse horário para fazer o pedido.`
    );
}

export type StoreHoursPublic = {
    openTime: string | null;
    closeTime: string | null;
    timeZone: string;
    deliveryDescription: string | null;
    isOpen: boolean;
};

export function toStoreHoursPublic(hours: StoreHours, nowMs = Date.now()): StoreHoursPublic {
    return {
        openTime: hours.openTime,
        closeTime: hours.closeTime,
        timeZone: hours.timeZone,
        deliveryDescription: hours.deliveryDescription,
        isOpen: isStoreOpen(nowMs, hours),
    };
}
