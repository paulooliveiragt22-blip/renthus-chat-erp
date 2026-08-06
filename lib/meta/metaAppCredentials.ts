import "server-only";

const GRAPH_VERSION = process.env.META_GRAPH_VERSION?.trim() || "v20.0";

export function resolveMetaAppId(env: NodeJS.ProcessEnv = process.env): string {
    return (
        env.META_APP_ID?.trim() ||
        env.FACEBOOK_APP_ID?.trim() ||
        env.WHATSAPP_META_APP_ID?.trim() ||
        ""
    );
}

export function resolveMetaAppSecret(env: NodeJS.ProcessEnv = process.env): string {
    return (
        env.META_APP_SECRET?.trim() ||
        env.WHATSAPP_APP_SECRET?.trim() ||
        env.FACEBOOK_APP_SECRET?.trim() ||
        ""
    );
}

export function metaGraphVersion(env: NodeJS.ProcessEnv = process.env): string {
    return env.META_GRAPH_VERSION?.trim() || GRAPH_VERSION;
}

/** Escopos para Messenger + Instagram Messaging via Facebook Login. */
export const META_MESSAGING_OAUTH_SCOPES = [
    "pages_show_list",
    "pages_manage_metadata",
    "pages_messaging",
    "pages_read_engagement",
    "business_management",
    "instagram_basic",
    "instagram_manage_messages",
].join(",");
