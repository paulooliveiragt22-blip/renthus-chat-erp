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
 * Secret do produto "API do Instagram" (app IG `28138…` no dashboard).
 * Webhooks assinados nesse produto podem usar este secret, não o do app principal.
 */
export function resolveInstagramAppSecret(env: EnvLike = process.env): string {
    return (
        env.META_INSTAGRAM_APP_SECRET?.trim() ||
        env.INSTAGRAM_APP_SECRET?.trim() ||
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

/** Configuration ID do Embedded Signup WhatsApp — nunca reutilizar o do IG/Page. */
export function resolveEmbeddedSignupConfigId(env: EnvLike = process.env): string {
    return (
        env.META_EMBEDDED_SIGNUP_CONFIG_ID?.trim() ||
        env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID?.trim() ||
        ""
    );
}

export function metaGraphVersion(env: EnvLike = process.env): string {
    return env.META_GRAPH_VERSION?.trim() || GRAPH_VERSION;
}

export {
    META_MESSAGING_OAUTH_SCOPE_LIST,
    META_MESSAGING_OAUTH_SCOPES,
} from "@/lib/meta/metaOauthScopes";
