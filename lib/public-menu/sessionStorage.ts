/** Persistência leve de sessão do cardápio no browser (sessionStorage). */

export type StoredMenuSession = {
    sessionToken: string;
    customerName: string | null;
    phoneE164: string;
};

function key(slug: string): string {
    return `renthus_menu_sess_${slug}`;
}

export function loadStoredMenuSession(slug: string): StoredMenuSession | null {
    try {
        const raw = globalThis.sessionStorage?.getItem(key(slug));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as StoredMenuSession;
        if (!parsed?.sessionToken || !parsed?.phoneE164) return null;
        return parsed;
    } catch {
        return null;
    }
}

export function saveStoredMenuSession(slug: string, session: StoredMenuSession): void {
    try {
        globalThis.sessionStorage?.setItem(key(slug), JSON.stringify(session));
    } catch {
        /* ignore */
    }
}

export function clearStoredMenuSession(slug: string): void {
    try {
        globalThis.sessionStorage?.removeItem(key(slug));
    } catch {
        /* ignore */
    }
}
