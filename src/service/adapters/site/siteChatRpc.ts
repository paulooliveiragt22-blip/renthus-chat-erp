import type { SupabaseClient } from "@supabase/supabase-js";
import { httpsOfferLink, offerLinkLabel } from "@/src/service/domain/offerLink";
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

export function linksFrom(raw: unknown): SiteChatLink[] {
    if (!Array.isArray(raw)) return [];
    const links: SiteChatLink[] = [];
    for (const item of raw) {
        const row = asRecord(item);
        if (!row) continue;
        const url = httpsOfferLink(typeof row.url === "string" ? row.url : null);
        if (!url || links.some((link) => link.url === url)) continue;
        links.push({ label: offerLinkLabel(typeof row.label === "string" ? row.label : null), url });
        if (links.length >= 3) break;
    }
    return links;
}

export function messagesFrom(raw: unknown): SiteChatMessage[] {
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item) => {
        const row = asRecord(item);
        if (!row) return [];
        const role = row.role === "assistant" || row.role === "user" ? row.role : null;
        if (!role || typeof row.body !== "string") return [];
        return [{ role, body: row.body, links: linksFrom(row.links) }];
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
    links: readonly SiteChatLink[]
): Promise<void> {
    await callRpc(admin, "rpc_site_chat_finish", {
        p_company_id: companyId,
        p_session_id: sessionId,
        p_body: body,
        p_links: links.map((link) => ({ label: link.label, url: link.url })),
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
        companyName: typeof row.company_name === "string" && row.company_name.trim().length > 0 ? row.company_name.trim() : "Atendimento",
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
