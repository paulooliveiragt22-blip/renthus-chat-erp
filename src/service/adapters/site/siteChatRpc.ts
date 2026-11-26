import type { SupabaseClient } from "@supabase/supabase-js";
import { httpsOfferLink, offerLinkLabel } from "@/src/service/domain/offerLink";
import type { SitePlanCard, SitePlanOption } from "@/src/service/domain/offeringSpeech";
import { siteChatReplies, type SiteChatLink, type SiteChatPriorTurn, type SiteChatRole } from "@/src/service/domain/siteChat";

export type SiteChatBegin =
    | {
          ok: true;
          sessionId: string;
          messageId: string;
          remaining: number;
          history: SiteChatPriorTurn[];
      }
    | { ok: false; code: "session_cap"; sessionId: string; remaining: 0 }
    | { ok: false; code: "body_invalid" | "not_service" | "session_invalid" };

export type SiteChatMessage = {
    role: SiteChatRole;
    body: string;
    links: SiteChatLink[];
    cards: SitePlanCard[];
};

function asRecord(raw: unknown): Record<string, unknown> | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    return raw as Record<string, unknown>;
}

function priorFrom(raw: unknown): SiteChatPriorTurn[] {
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item) => {
        const row = asRecord(item);
        if (!row) return [];
        const role = row.role === "assistant" || row.role === "user" ? row.role : null;
        if (!role || typeof row.body !== "string" || row.body.trim().length === 0) return [];
        return [{ role, text: row.body }];
    });
}

const STORE_LABEL = "Chamar no WhatsApp";

function httpsStoreLink(value: string): string | null {
    if (!value.startsWith("https://") || value.length > 1000 || /\s/u.test(value)) return null;
    try {
        const url = new URL(value);
        if (url.protocol !== "https:" || !url.hostname) return null;
        return value;
    } catch {
        return null;
    }
}

export function linksFrom(raw: unknown): SiteChatLink[] {
    if (!Array.isArray(raw)) return [];
    const links: SiteChatLink[] = [];
    for (const item of raw) {
        const row = asRecord(item);
        if (!row || row.kind === "plan") continue;
        const rawUrl = typeof row.url === "string" ? row.url : null;
        if (row.label === STORE_LABEL && rawUrl) {
            const url = httpsStoreLink(rawUrl);
            if (!url || links.some((link) => link.url === url)) continue;
            links.push({ label: STORE_LABEL, url });
            if (links.length >= 3) break;
            continue;
        }
        const url = httpsOfferLink(rawUrl);
        if (!url || links.some((link) => link.url === url)) continue;
        links.push({ label: offerLinkLabel(typeof row.label === "string" ? row.label : null), url });
        if (links.length >= 3) break;
    }
    return links;
}

function optionFrom(raw: unknown): SitePlanOption | null {
    const row = asRecord(raw);
    if (!row || typeof row.offeringId !== "string" || typeof row.label !== "string" || typeof row.price !== "string") {
        return null;
    }
    if (!/^[0-9a-f-]{36}$/iu.test(row.offeringId)) return null;
    const label = row.label.trim();
    const price = row.price.trim();
    if (label.length < 1 || label.length > 20 || price.length < 1 || price.length > 40) return null;
    const note = typeof row.note === "string" && row.note.trim().length > 0 ? row.note.trim().slice(0, 40) : null;
    return { offeringId: row.offeringId, label, price, note };
}

export function cardsFrom(raw: unknown): SitePlanCard[] {
    if (!Array.isArray(raw)) return [];
    const cards: SitePlanCard[] = [];
    for (const item of raw) {
        const row = asRecord(item);
        if (!row || row.kind !== "plan" || typeof row.title !== "string") continue;
        const title = row.title.trim();
        if (title.length < 2 || title.length > 40) continue;
        const benefits = Array.isArray(row.benefits)
            ? row.benefits.filter((line): line is string => typeof line === "string" && line.trim().length > 0).map((line) => line.trim().slice(0, 80)).slice(0, 4)
            : [];
        const options = Array.isArray(row.options) ? row.options.flatMap((option) => {
            const parsed = optionFrom(option);
            return parsed ? [parsed] : [];
        }).slice(0, 2) : [];
        if (options.length === 0) continue;
        cards.push({ title, benefits, options });
        if (cards.length >= 6) break;
    }
    return cards;
}

export function messagesFrom(raw: unknown): SiteChatMessage[] {
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item) => {
        const row = asRecord(item);
        if (!row) return [];
        const role = row.role === "assistant" || row.role === "user" ? row.role : null;
        if (!role || typeof row.body !== "string") return [];
        return [{ role, body: row.body, links: linksFrom(row.links), cards: cardsFrom(row.links) }];
    });
}

async function callRpc(
    admin: SupabaseClient,
    fn: string,
    args: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
    const { data, error } = await admin.rpc(fn, args);
    if (error) throw new Error(`site_chat_rpc:${fn}:${error.message}`);
    return asRecord(data);
}

export async function beginSiteChat(
    admin: SupabaseClient,
    companyId: string,
    sessionId: string | null,
    body: string,
    reset: boolean
): Promise<SiteChatBegin> {
    const row = await callRpc(admin, "rpc_site_chat_begin", {
        p_company_id: companyId,
        p_session_id: sessionId,
        p_body: body,
        p_reset: reset,
    });
    if (!row || row.ok !== true) {
        const code = row?.code;
        if (code === "session_cap" && typeof row?.session_id === "string") {
            return { ok: false, code: "session_cap", sessionId: row.session_id, remaining: 0 };
        }
        if (code === "body_invalid" || code === "not_service") return { ok: false, code };
        return { ok: false, code: "session_invalid" };
    }
    if (typeof row.session_id !== "string" || typeof row.message_id !== "string") {
        return { ok: false, code: "session_invalid" };
    }
    const remaining = typeof row.remaining === "number" ? row.remaining : 0;
    return {
        ok: true,
        sessionId: row.session_id,
        messageId: row.message_id,
        remaining,
        history: priorFrom(row.history),
    };
}

export async function finishSiteChat(
    admin: SupabaseClient,
    companyId: string,
    sessionId: string,
    body: string,
    links: readonly SiteChatLink[],
    cards: readonly SitePlanCard[] = []
): Promise<void> {
    await callRpc(admin, "rpc_site_chat_finish", {
        p_company_id: companyId,
        p_session_id: sessionId,
        p_body: body,
        p_links: [
            ...links.map((link) => ({ label: link.label, url: link.url })),
            ...cards.map((card) => ({
                kind: "plan",
                title: card.title,
                benefits: card.benefits,
                options: card.options,
            })),
        ],
    });
}

export async function readSiteChat(
    admin: SupabaseClient,
    companyId: string,
    sessionId: string
): Promise<{ messages: SiteChatMessage[]; remaining: number }> {
    const row = await callRpc(admin, "rpc_site_chat_read", {
        p_company_id: companyId,
        p_session_id: sessionId,
    });
    const remaining = typeof row?.remaining === "number" ? row.remaining : 8;
    return { messages: messagesFrom(row?.messages), remaining };
}

export type SiteChatPublic = {
    companyId: string;
    companyName: string;
    publicKey: string | null;
    replies: string[];
};

function publicFrom(row: Record<string, unknown> | null, key: string | null): SiteChatPublic | null {
    if (!row || row.ok !== true || typeof row.company_id !== "string") return null;
    return {
        companyId: row.company_id,
        companyName: typeof row.company_name === "string" && row.company_name.trim().length > 0 ? row.company_name.trim() : "Office",
        publicKey: typeof row.site_chat_key === "string" ? row.site_chat_key : key,
        replies: siteChatReplies(row.replies),
    };
}

export async function readSiteChatPublic(admin: SupabaseClient, key: string): Promise<SiteChatPublic | null> {
    const row = await callRpc(admin, "rpc_site_chat_public", { p_key: key });
    return publicFrom(row, key);
}

export async function readSiteChatPublicCompany(admin: SupabaseClient, companyId: string): Promise<SiteChatPublic | null> {
    const row = await callRpc(admin, "rpc_site_chat_public_company", { p_company_id: companyId });
    return publicFrom(row, null);
}
