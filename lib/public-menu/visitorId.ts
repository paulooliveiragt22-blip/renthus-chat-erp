const KEY = "renthus_menu_visitor_id";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function randomUuid(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replaceAll(/[xy]/g, (c) => {
        const r = Math.trunc(Math.random() * 16);
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

/** Visitor anônimo persistido no browser (LGPD-light — sem PII). */
export function getOrCreateMenuVisitorId(): string {
    if (typeof globalThis.window === "undefined") return randomUuid();
    try {
        const existing = globalThis.localStorage.getItem(KEY);
        if (existing && UUID_RE.test(existing)) return existing;
        const id = randomUuid();
        globalThis.localStorage.setItem(KEY, id);
        return id;
    } catch {
        return randomUuid();
    }
}
