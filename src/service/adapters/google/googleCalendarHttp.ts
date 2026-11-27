import "server-only";

import { appPublicOrigin } from "@/lib/marketing/hosts";
import {
    GOOGLE_CALENDAR_CALLBACK_PATH,
    GOOGLE_CALENDAR_SCOPES,
    googleEventBody,
    googleScopesGranted,
    type BusyInterval,
} from "@/src/service/domain/googleCalendar";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export type GoogleTokenResult =
    | { ok: true; accessToken: string; refreshToken: string | null; scope: string }
    | { ok: false; reason: "invalid_grant" | "denied" | "missing_scope" };

export function googleCalendarConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
    return Boolean(env.GOOGLE_CALENDAR_CLIENT_ID?.trim() && env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim());
}

export function googleCalendarRedirectUri(env: NodeJS.ProcessEnv = process.env): string {
    return `${appPublicOrigin(env)}${GOOGLE_CALENDAR_CALLBACK_PATH}`;
}

function clientId(env: NodeJS.ProcessEnv = process.env): string {
    return env.GOOGLE_CALENDAR_CLIENT_ID?.trim() ?? "";
}

function clientSecret(env: NodeJS.ProcessEnv = process.env): string {
    return env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim() ?? "";
}

async function googleFetch(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

export function googleAuthorizeUrl(state: string, env: NodeJS.ProcessEnv = process.env): string {
    const url = new URL(AUTH_URL);
    url.searchParams.set("client_id", clientId(env));
    url.searchParams.set("redirect_uri", googleCalendarRedirectUri(env));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPES.join(" "));
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);
    return url.toString();
}

export async function exchangeGoogleCode(code: string, env: NodeJS.ProcessEnv = process.env): Promise<GoogleTokenResult> {
    const body = new URLSearchParams({
        code,
        client_id: clientId(env),
        client_secret: clientSecret(env),
        redirect_uri: googleCalendarRedirectUri(env),
        grant_type: "authorization_code",
    });
    const res = await googleFetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    });
    const json = asRecord(await res.json().catch(() => null));
    const error = typeof json?.error === "string" ? json.error : "";
    if (!res.ok) return { ok: false, reason: error === "invalid_grant" ? "invalid_grant" : "denied" };
    const accessToken = typeof json?.access_token === "string" ? json.access_token : "";
    const scope = typeof json?.scope === "string" ? json.scope : "";
    const refreshToken = typeof json?.refresh_token === "string" ? json.refresh_token : null;
    if (!accessToken || !googleScopesGranted(scope)) return { ok: false, reason: "missing_scope" };
    return { ok: true, accessToken, refreshToken, scope };
}

export async function refreshGoogleAccessToken(
    refreshToken: string,
    env: NodeJS.ProcessEnv = process.env
): Promise<{ ok: true; accessToken: string } | { ok: false; reason: "invalid_grant" | "denied" }> {
    const body = new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId(env),
        client_secret: clientSecret(env),
        grant_type: "refresh_token",
    });
    const res = await googleFetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    });
    const json = asRecord(await res.json().catch(() => null));
    const error = typeof json?.error === "string" ? json.error : "";
    if (!res.ok) return { ok: false, reason: error === "invalid_grant" ? "invalid_grant" : "denied" };
    const accessToken = typeof json?.access_token === "string" ? json.access_token : "";
    if (!accessToken) return { ok: false, reason: "denied" };
    return { ok: true, accessToken };
}

export async function googleAccountEmail(accessToken: string): Promise<string | null> {
    const res = await googleFetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const json = asRecord(await res.json().catch(() => null));
    const email = typeof json?.email === "string" ? json.email.trim() : "";
    return email.includes("@") ? email : null;
}

export async function revokeGoogleToken(token: string): Promise<void> {
    const body = new URLSearchParams({ token });
    await googleFetch(REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    });
}

export async function queryGoogleBusy(
    accessToken: string,
    calendarId: string,
    timeMin: string,
    timeMax: string
): Promise<{ ok: true; busy: BusyInterval[] } | { ok: false }> {
    const res = await googleFetch(`${CALENDAR_API}/freeBusy`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ timeMin, timeMax, items: [{ id: calendarId }] }),
    });
    if (!res.ok) return { ok: false };
    const json = asRecord(await res.json().catch(() => null));
    const calendars = asRecord(json?.calendars);
    const calendar = asRecord(calendars?.[calendarId]);
    if (!calendar || (Array.isArray(calendar.errors) && calendar.errors.length > 0)) return { ok: false };
    const busy = Array.isArray(calendar.busy)
        ? calendar.busy.flatMap((item) => {
            const row = asRecord(item);
            if (typeof row?.start !== "string" || typeof row.end !== "string") return [];
            return [{ start: row.start, end: row.end }];
        })
        : [];
    return { ok: true, busy };
}

export type GoogleListedEvent = {
    id: string;
    summary: string;
    startsAt: string;
    endsAt: string;
    allDay: boolean;
};

export async function listGoogleEvents(
    accessToken: string,
    calendarId: string,
    timeMin: string,
    timeMax: string
): Promise<{ ok: true; events: GoogleListedEvent[] } | { ok: false }> {
    const events: GoogleListedEvent[] = [];
    let pageToken = "";
    for (let page = 0; page < 4; page += 1) {
        const url = new URL(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`);
        url.searchParams.set("timeMin", timeMin);
        url.searchParams.set("timeMax", timeMax);
        url.searchParams.set("singleEvents", "true");
        url.searchParams.set("orderBy", "startTime");
        url.searchParams.set("maxResults", "250");
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const res = await googleFetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!res.ok) return { ok: false };
        const json = asRecord(await res.json().catch(() => null));
        const items = Array.isArray(json?.items) ? json.items : [];
        for (const item of items) {
            const row = asRecord(item);
            if (!row || row.status === "cancelled" || typeof row.id !== "string") continue;
            const start = asRecord(row.start);
            const end = asRecord(row.end);
            const allDay = typeof start?.date === "string";
            const startsAt = allDay ? `${start?.date}T00:00:00` : typeof start?.dateTime === "string" ? start.dateTime : "";
            const endsAt = allDay
                ? `${typeof end?.date === "string" ? end.date : start?.date}T00:00:00`
                : typeof end?.dateTime === "string"
                  ? end.dateTime
                  : "";
            if (!startsAt || !endsAt) continue;
            const summary = typeof row.summary === "string" && row.summary.trim() ? row.summary.trim() : "Sem título";
            events.push({ id: row.id, summary: summary.slice(0, 200), startsAt, endsAt, allDay });
        }
        pageToken = typeof json?.nextPageToken === "string" ? json.nextPageToken : "";
        if (!pageToken) break;
    }
    return { ok: true, events };
}

export async function insertGoogleEvent(
    accessToken: string,
    calendarId: string,
    event: ReturnType<typeof googleEventBody>
): Promise<{ ok: true; eventId: string } | { ok: false }> {
    const res = await googleFetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
    });
    if (!res.ok) return { ok: false };
    const json = asRecord(await res.json().catch(() => null));
    const eventId = typeof json?.id === "string" ? json.id : "";
    return eventId ? { ok: true, eventId } : { ok: false };
}

export async function patchGoogleEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    event: ReturnType<typeof googleEventBody>
): Promise<{ ok: true } | { ok: false; missing: boolean }> {
    const res = await googleFetch(
        `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        {
            method: "PATCH",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(event),
        }
    );
    if (res.status === 404 || res.status === 410) return { ok: false, missing: true };
    return res.ok ? { ok: true } : { ok: false, missing: false };
}

export async function deleteGoogleEvent(accessToken: string, calendarId: string, eventId: string): Promise<boolean> {
    const res = await googleFetch(
        `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return res.ok || res.status === 404 || res.status === 410;
}
