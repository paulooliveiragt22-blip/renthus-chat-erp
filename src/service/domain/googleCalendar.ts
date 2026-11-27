export const GOOGLE_CALENDAR_CALLBACK_PATH = "/api/admin/google-calendar/callback";

export const GOOGLE_CALENDAR_SCOPES = [
    "openid",
    "email",
    "https://www.googleapis.com/auth/calendar.freebusy",
    "https://www.googleapis.com/auth/calendar.events",
] as const;

const REQUIRED_SCOPES = [
    "https://www.googleapis.com/auth/calendar.freebusy",
    "https://www.googleapis.com/auth/calendar.events",
] as const;

export type BusyInterval = { start: string; end: string };

export function googleScopesGranted(scope: string | null | undefined): boolean {
    const parts = new Set((scope ?? "").split(/\s+/u).filter((item) => item.length > 0));
    return REQUIRED_SCOPES.every((item) => parts.has(item));
}

export function rangeHitsBusy(
    startIso: string,
    endIso: string,
    busy: readonly BusyInterval[],
    ignore?: { start: string; end: string }
): boolean {
    const start = Date.parse(startIso);
    const end = Date.parse(endIso);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return true;
    const ownStart = ignore ? Date.parse(ignore.start) : Number.NaN;
    const ownEnd = ignore ? Date.parse(ignore.end) : Number.NaN;
    const hasOwn = Number.isFinite(ownStart) && Number.isFinite(ownEnd) && ownEnd > ownStart;
    for (const block of busy) {
        const blockStart = Date.parse(block.start);
        const blockEnd = Date.parse(block.end);
        if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd) || blockEnd <= blockStart) continue;
        const pieces: Array<[number, number]> = [];
        if (!hasOwn) {
            pieces.push([blockStart, blockEnd]);
        } else {
            if (blockStart < ownStart) pieces.push([blockStart, Math.min(blockEnd, ownStart)]);
            if (blockEnd > ownEnd) pieces.push([Math.max(blockStart, ownEnd), blockEnd]);
        }
        for (const [pieceStart, pieceEnd] of pieces) {
            if (pieceEnd > pieceStart && start < pieceEnd && end > pieceStart) return true;
        }
    }
    return false;
}

export function slotOverlapsBusy(startIso: string, durationMin: number, busy: readonly BusyInterval[]): boolean {
    if (durationMin <= 0) return true;
    const start = Date.parse(startIso);
    if (!Number.isFinite(start)) return true;
    return rangeHitsBusy(startIso, new Date(start + durationMin * 60_000).toISOString(), busy);
}

export function filterFreeSlots(
    slots: readonly string[],
    durationMin: number,
    busy: readonly BusyInterval[]
): string[] {
    return slots.filter((slot) => !slotOverlapsBusy(slot, durationMin, busy));
}

export function googleEventBody(input: {
    offeringName: string;
    customerName: string | null;
    startsAt: string;
    endsAt: string;
    timeZone: string;
}): { summary: string; start: { dateTime: string; timeZone: string }; end: { dateTime: string; timeZone: string } } {
    const who = input.customerName?.trim() ?? "";
    const summary = (who.length > 0 ? `${input.offeringName} — ${who}` : input.offeringName).slice(0, 200);
    return {
        summary,
        start: { dateTime: input.startsAt, timeZone: input.timeZone },
        end: { dateTime: input.endsAt, timeZone: input.timeZone },
    };
}
