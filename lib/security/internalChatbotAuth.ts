/**
 * Auth for server-to-server calls to chatbot resolve (not Supabase service_role).
 */
import { timingSafeEqual } from "node:crypto";

export type InternalChatbotAuthResult =
    | { ok: true }
    | { ok: false; status: 401 | 500; error: "unauthorized" | "server_misconfigured" };

function isProductionEnv(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.VERCEL_ENV === "production" || env.NODE_ENV === "production";
}

function timingSafeEqualUtf8(a: string, b: string): boolean {
    const ba = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
}

/**
 * Validates `x-service-key` against `INTERNAL_CHATBOT_SECRET`.
 * Fail-closed in production when the env is missing.
 * Never compares to `SUPABASE_SERVICE_ROLE_KEY`.
 */
export function validateInternalChatbotSecret(
    headerValue: string | null | undefined,
    env: NodeJS.ProcessEnv = process.env
): InternalChatbotAuthResult {
    const expected = env.INTERNAL_CHATBOT_SECRET?.trim() ?? "";
    const provided = typeof headerValue === "string" ? headerValue.trim() : "";

    if (!expected) {
        if (isProductionEnv(env)) {
            return { ok: false, status: 500, error: "server_misconfigured" };
        }
        return { ok: false, status: 401, error: "unauthorized" };
    }

    if (!provided || !timingSafeEqualUtf8(provided, expected)) {
        return { ok: false, status: 401, error: "unauthorized" };
    }

    return { ok: true };
}
