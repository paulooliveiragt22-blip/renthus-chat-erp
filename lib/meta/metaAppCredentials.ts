import "server-only";
import type { EnvLike } from "@/lib/env/EnvLike";

const GRAPH_VERSION = process.env.META_GRAPH_VERSION?.trim() || "v20.0";

export function resolveMetaAppId(env: EnvLike = process.env): string {
    return (
        env.META_APP_ID?.trim() ||
        env.FACEBOOK_APP_ID?.trim() ||
        env.WHATSAPP_META_APP_ID?.trim() ||
        ""
    );
}

export function resolveMetaAppSecret(env: EnvLike = process.env): string {
    return (
        env.META_APP_SECRET?.trim() ||
        env.WHATSAPP_APP_SECRET?.trim() ||
        env.FACEBOOK_APP_SECRET?.trim() ||
        ""
    );
}

/**
 * Configuration ID do Facebook Login for Business.
 * Apps tipo Business costumam exigir `config_id` no dialog/oauth;
 * sem isso a Meta pode responder "URL bloqueada" mesmo com redirect URI cadastrada.
 */
export function resolveMetaLoginConfigId(env: EnvLike = process.env): string {
    return (
        env.META_LOGIN_CONFIG_ID?.trim() ||
        env.META_FACEBOOK_LOGIN_CONFIG_ID?.trim() ||
        ""
    );
}

export function metaGraphVersion(env: EnvLike = process.env): string {
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
