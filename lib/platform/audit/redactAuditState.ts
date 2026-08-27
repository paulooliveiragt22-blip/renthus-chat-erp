const SECRET_KEYS = new Set([
    "access_token",
    "encrypted_access_token",
    "refresh_token",
    "password",
    "secret",
    "service_role_key",
    "token",
]);

function redactValue(key: string, value: unknown): unknown {
    const k = key.toLowerCase();
    if (SECRET_KEYS.has(k) || k.includes("token") || k.includes("secret")) {
        return "[REDACTED]";
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return redactAuditState(value as Record<string, unknown>);
    }
    if (Array.isArray(value)) {
        return value.map((v, i) => redactValue(String(i), v));
    }
    return value;
}

export function redactAuditState(
    state: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
    if (!state) return null;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(state)) {
        out[k] = redactValue(k, v);
    }
    return out;
}
