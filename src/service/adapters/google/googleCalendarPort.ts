import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptCredential } from "@/lib/security/credentialCrypto";
import { filterFreeSlots, googleEventBody, rangeHitsBusy } from "@/src/service/domain/googleCalendar";
import type { GoogleGate, ServiceCalendarPort } from "@/src/service/ports/serviceTurnPorts";
import {
    deleteGoogleEvent,
    googleCalendarConfigured,
    insertGoogleEvent,
    listGoogleEvents,
    patchGoogleEvent,
    queryGoogleBusy,
    refreshGoogleAccessToken,
    revokeGoogleToken,
} from "@/src/service/adapters/google/googleCalendarHttp";

type ReadyConnection = {
    refreshToken: string;
    calendarId: string;
};

type AppointmentMirror = {
    startsAt: string;
    endsAt: string;
    offeringName: string;
    customerName: string | null;
    label: string | null;
    googleEventId: string | null;
    timeZone: string;
    status: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

async function rpc(admin: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const { data, error } = await admin.rpc(fn, args);
    if (error) return null;
    return asRecord(data);
}

async function loadReady(admin: SupabaseClient, companyId: string): Promise<ReadyConnection | GoogleGate> {
    const row = await rpc(admin, "rpc_service_google_secret", { p_company_id: companyId });
    if (!row || row.ok !== true || row.connected !== true) {
        return row?.link_status === "revoked" ? "unavailable" : "off";
    }
    if (!googleCalendarConfigured()) return "unavailable";
    const enc = typeof row.refresh_token_enc === "string" ? row.refresh_token_enc : "";
    const refreshToken = decryptCredential(enc);
    if (!refreshToken) return "unavailable";
    const calendarId = typeof row.calendar_id === "string" && row.calendar_id.trim() ? row.calendar_id : "primary";
    return { refreshToken, calendarId };
}

async function accessToken(admin: SupabaseClient, companyId: string, ready: ReadyConnection): Promise<string | GoogleGate> {
    const refreshed = await refreshGoogleAccessToken(ready.refreshToken);
    if (refreshed.ok) return refreshed.accessToken;
    if (refreshed.reason === "invalid_grant") {
        await rpc(admin, "rpc_service_google_revoke", { p_company_id: companyId });
    }
    return "unavailable";
}

async function mark(
    admin: SupabaseClient,
    companyId: string,
    appointmentId: string,
    eventId: string | null,
    sync: "synced" | "failed"
): Promise<void> {
    await rpc(admin, "rpc_service_google_mark", {
        p_company_id: companyId,
        p_appointment_id: appointmentId,
        p_event_id: eventId,
        p_sync: sync,
    });
}

async function loadMirror(admin: SupabaseClient, companyId: string, appointmentId: string): Promise<AppointmentMirror | null> {
    const row = await rpc(admin, "rpc_service_appointment_mirror", {
        p_company_id: companyId,
        p_appointment_id: appointmentId,
    });
    if (!row || row.ok !== true || typeof row.starts_at !== "string" || typeof row.ends_at !== "string") return null;
    if (typeof row.offering_name !== "string") return null;
    return {
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        offeringName: row.offering_name,
        customerName: typeof row.customer_name === "string" ? row.customer_name : null,
        label: typeof row.label === "string" ? row.label : null,
        googleEventId: typeof row.google_event_id === "string" ? row.google_event_id : null,
        timeZone: typeof row.time_zone === "string" ? row.time_zone : "America/Cuiaba",
        status: typeof row.status === "string" ? row.status : "",
    };
}

async function gateWindow(
    admin: SupabaseClient,
    companyId: string,
    startsAt: string,
    endsAt: string,
    ignore?: { start: string; end: string }
): Promise<GoogleGate> {
    const ready = await loadReady(admin, companyId);
    if (typeof ready === "string") return ready;
    const token = await accessToken(admin, companyId, ready);
    if (typeof token !== "string") return token;
    const busy = await queryGoogleBusy(token, ready.calendarId, startsAt, endsAt);
    if (!busy.ok) return "unavailable";
    return rangeHitsBusy(startsAt, endsAt, busy.busy, ignore) ? "busy" : "free";
}

async function writeEvent(
    admin: SupabaseClient,
    companyId: string,
    appointmentId: string,
    mirror: AppointmentMirror,
    ready: ReadyConnection,
    token: string
): Promise<void> {
    const body = googleEventBody({
        offeringName: mirror.offeringName,
        customerName: mirror.customerName,
        label: mirror.label,
        startsAt: mirror.startsAt,
        endsAt: mirror.endsAt,
        timeZone: mirror.timeZone,
    });
    if (mirror.googleEventId) {
        const patched = await patchGoogleEvent(token, ready.calendarId, mirror.googleEventId, body);
        if (patched.ok) {
            await mark(admin, companyId, appointmentId, mirror.googleEventId, "synced");
            return;
        }
        if (!patched.missing) {
            await mark(admin, companyId, appointmentId, mirror.googleEventId, "failed");
            return;
        }
    }
    const inserted = await insertGoogleEvent(token, ready.calendarId, body);
    await mark(admin, companyId, appointmentId, inserted.ok ? inserted.eventId : mirror.googleEventId, inserted.ok ? "synced" : "failed");
}

export function createGoogleCalendarPort(admin: SupabaseClient): ServiceCalendarPort {
    return {
        async gateOpenSlot(companyId, threadId) {
            const row = await rpc(admin, "rpc_service_peek_open_slot", {
                p_company_id: companyId,
                p_thread_id: threadId,
            });
            if (!row || row.ok !== true || typeof row.starts_at !== "string" || typeof row.ends_at !== "string") {
                return "missing";
            }
            return gateWindow(admin, companyId, row.starts_at, row.ends_at);
        },
        async gateOffering(companyId, offeringId, startsAt) {
            const row = await rpc(admin, "rpc_service_slot_window", {
                p_company_id: companyId,
                p_offering_id: offeringId,
                p_starts_at: startsAt,
            });
            if (!row || row.ok !== true || typeof row.starts_at !== "string" || typeof row.ends_at !== "string") {
                return "off";
            }
            return gateWindow(admin, companyId, row.starts_at, row.ends_at);
        },
        async gateMoved(companyId, appointmentId, startsAt) {
            const current = await loadMirror(admin, companyId, appointmentId);
            const startMs = Date.parse(startsAt);
            if (!current || !Number.isFinite(startMs)) return "off";
            const duration = Date.parse(current.endsAt) - Date.parse(current.startsAt);
            if (!Number.isFinite(duration) || duration <= 0) return "off";
            const endsAt = new Date(startMs + duration).toISOString();
            return gateWindow(admin, companyId, startsAt, endsAt, { start: current.startsAt, end: current.endsAt });
        },
        async filterSlots(companyId, slots, durationMin) {
            if (slots.length === 0 || durationMin <= 0) return { slots: [...slots], gate: "off" };
            const ready = await loadReady(admin, companyId);
            if (ready === "off") return { slots: [...slots], gate: "off" };
            if (typeof ready === "string") return { slots: [], gate: "unavailable" };
            const token = await accessToken(admin, companyId, ready);
            if (typeof token !== "string") return { slots: [], gate: "unavailable" };
            const starts = slots.map((slot) => Date.parse(slot)).filter((value) => Number.isFinite(value));
            if (starts.length === 0) return { slots: [], gate: "unavailable" };
            const timeMin = new Date(Math.min(...starts)).toISOString();
            const timeMax = new Date(Math.max(...starts) + durationMin * 60_000).toISOString();
            const busy = await queryGoogleBusy(token, ready.calendarId, timeMin, timeMax);
            if (!busy.ok) return { slots: [], gate: "unavailable" };
            return { slots: filterFreeSlots(slots, durationMin, busy.busy), gate: "free" };
        },
        async mirrorBooked(companyId, appointmentId) {
            try {
                const ready = await loadReady(admin, companyId);
                if (typeof ready === "string") return;
                const mirror = await loadMirror(admin, companyId, appointmentId);
                if (!mirror || mirror.status === "cancelled") return;
                if (mirror.googleEventId) return;
                const token = await accessToken(admin, companyId, ready);
                if (typeof token !== "string") {
                    await mark(admin, companyId, appointmentId, null, "failed");
                    return;
                }
                await writeEvent(admin, companyId, appointmentId, mirror, ready, token);
            } catch {
                await mark(admin, companyId, appointmentId, null, "failed");
            }
        },
        async mirrorCancelled(companyId, appointmentId) {
            try {
                const ready = await loadReady(admin, companyId);
                if (typeof ready === "string") return;
                const mirror = await loadMirror(admin, companyId, appointmentId);
                if (!mirror?.googleEventId) return;
                const token = await accessToken(admin, companyId, ready);
                if (typeof token !== "string") return;
                const removed = await deleteGoogleEvent(token, ready.calendarId, mirror.googleEventId);
                if (!removed) await mark(admin, companyId, appointmentId, mirror.googleEventId, "failed");
            } catch {
                /* a marcação no Postgres já foi cancelada */
            }
        },
        async mirrorMoved(companyId, fromAppointmentId, toAppointmentId) {
            try {
                const ready = await loadReady(admin, companyId);
                if (typeof ready === "string") return;
                const previous = await loadMirror(admin, companyId, fromAppointmentId);
                const next = await loadMirror(admin, companyId, toAppointmentId);
                if (!next) return;
                const token = await accessToken(admin, companyId, ready);
                if (typeof token !== "string") {
                    await mark(admin, companyId, toAppointmentId, previous?.googleEventId ?? null, "failed");
                    return;
                }
                await writeEvent(
                    admin,
                    companyId,
                    toAppointmentId,
                    { ...next, googleEventId: previous?.googleEventId ?? next.googleEventId },
                    ready,
                    token
                );
            } catch {
                await mark(admin, companyId, toAppointmentId, null, "failed");
            }
        },
        async listWindow(companyId, fromIso, toIso) {
            const ready = await loadReady(admin, companyId);
            if (ready === "off") return { connected: false, unavailable: false, events: [] };
            if (typeof ready === "string") return { connected: true, unavailable: true, events: [] };
            const token = await accessToken(admin, companyId, ready);
            if (typeof token !== "string") return { connected: true, unavailable: true, events: [] };
            const listed = await listGoogleEvents(token, ready.calendarId, fromIso, toIso);
            if (!listed.ok) return { connected: true, unavailable: true, events: [] };
            return { connected: true, unavailable: false, events: listed.events };
        },
    };
}

export async function revokeStoredGoogleToken(admin: SupabaseClient, companyId: string): Promise<void> {
    const row = await rpc(admin, "rpc_service_google_secret", { p_company_id: companyId });
    const enc = typeof row?.refresh_token_enc === "string" ? row.refresh_token_enc : "";
    const refreshToken = decryptCredential(enc);
    if (!refreshToken) return;
    try {
        await revokeGoogleToken(refreshToken);
    } catch {
        /* a linha local sai mesmo se o Google não revogar */
    }
}

