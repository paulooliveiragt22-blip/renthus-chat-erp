/**
 * S14 — escopos mínimos (canônico). OAuth Page/IG pede só esta lista.
 * WhatsApp: token do lojista (paste); messaging obrigatório; management = templates.
 */

export const META_MESSAGING_OAUTH_SCOPE_LIST = [
    "pages_show_list",
    "pages_manage_metadata",
    "pages_messaging",
    "pages_read_engagement",
    "business_management",
    "instagram_basic",
    "instagram_manage_messages",
] as const;

export type MetaMessagingOauthScope = (typeof META_MESSAGING_OAUTH_SCOPE_LIST)[number];

export const META_MESSAGING_OAUTH_SCOPES = META_MESSAGING_OAUTH_SCOPE_LIST.join(",");

/** App Review / Login for Business às vezes entrega o alias novo no lugar de instagram_basic. */
const MESSAGING_SCOPE_ALIASES: Record<string, MetaMessagingOauthScope> = {
    instagram_business_basic: "instagram_basic",
};

export const META_WHATSAPP_REQUIRED_SCOPES = ["whatsapp_business_messaging"] as const;
export const META_WHATSAPP_TEMPLATE_SCOPES = ["whatsapp_business_management"] as const;
/** Embedded Signup: as duas permissões do App Review. */
export const META_WHATSAPP_EMBEDDED_REQUIRED_SCOPES = [
    "whatsapp_business_messaging",
    "whatsapp_business_management",
] as const;

/** Nunca aceitar num token de canal (Page OAuth ou WABA). */
export const META_FORBIDDEN_TOKEN_SCOPES = [
    "ads_management",
    "ads_read",
    "pages_manage_ads",
    "pages_manage_posts",
    "pages_manage_cta",
    "pages_manage_instant_articles",
    "publish_video",
    "publish_to_groups",
    "catalog_management",
    "leads_retrieval",
    "read_insights",
    "pages_manage_engagement",
] as const;

export type MetaScopeKind = "messaging" | "whatsapp" | "whatsapp_embedded";

export type MetaScopeVerdict = {
    ok: boolean;
    granted: string[];
    missing: string[];
    forbidden: string[];
};

function normalizeGranted(granted: readonly string[]): Set<string> {
    const out = new Set<string>();
    for (const raw of granted) {
        const s = raw.trim();
        if (!s) continue;
        out.add(s);
        const alias = MESSAGING_SCOPE_ALIASES[s];
        if (alias) out.add(alias);
    }
    return out;
}

export function evaluateGrantedMetaScopes(
    granted: readonly string[],
    kind: MetaScopeKind
): MetaScopeVerdict {
    const have = normalizeGranted(granted);
    const forbidden = META_FORBIDDEN_TOKEN_SCOPES.filter((s) => have.has(s));
    const required =
        kind === "messaging"
            ? META_MESSAGING_OAUTH_SCOPE_LIST
            : kind === "whatsapp_embedded"
              ? META_WHATSAPP_EMBEDDED_REQUIRED_SCOPES
              : META_WHATSAPP_REQUIRED_SCOPES;
    const missing = required.filter((s) => !have.has(s));
    return {
        ok: forbidden.length === 0 && missing.length === 0,
        granted: [...have].sort(),
        missing: [...missing],
        forbidden: [...forbidden],
    };
}

export function metaScopeVerdictMessage(v: MetaScopeVerdict, kind: MetaScopeKind): string {
    if (v.ok) return "";
    const bits: string[] = [];
    if (v.forbidden.length) {
        bits.push(`escopos não permitidos: ${v.forbidden.join(", ")}`);
    }
    if (v.missing.length) {
        bits.push(
            kind === "messaging"
                ? `faltam permissões de Page/IG: ${v.missing.join(", ")}`
                : kind === "whatsapp_embedded"
                  ? `faltam permissões WhatsApp Embedded Signup: ${v.missing.join(", ")}`
                  : `falta ${v.missing.join(", ")} no token WhatsApp`
        );
    }
    return bits.join("; ");
}
