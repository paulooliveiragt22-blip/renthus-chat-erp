/**
 * B15 — detecção estática de gate em rotas que usam `createAdminClient`.
 * Usado pelo teste de regressão e documentado em SECURITY_CREATEADMIN_INVENTORY.md.
 */

/** Padrões de autorização reconhecidos (borda Next antes do service_role). */
export const CREATE_ADMIN_GATE_PATTERNS: readonly RegExp[] = [
    /requireCompanyAccess\s*\(/,
    /requireCapability\s*\(/,
    /requireCompanyPlanFeature\s*\(/,
    /requireCompanyAnyPlanFeature\s*\(/,
    /validateCronAuthorization\s*\(/,
    /requirePlatformAccess\s*\(/,
    /withPlatformAccess\s*\(/,
    /verifyPrintAgentApiKey\s*\(/,
    /verifyAgentByApiKey\s*\(/,
    /validateInternalChatbotSecret\s*\(/,
    /assertPagarmeWebhookAuth\s*\(/,
    /verifyMeta(?:Signature|Webhook)?/i,
    /isValidMetaSignature\s*\(/,
    /enforcePublicMenuRateLimit\s*\(/,
    /enforceIpRateLimit(?:Async)?\s*\(/,
    /checkRateLimitByIpAsync\s*\(/,
    /publicMenuRateLimit\s*\(/,
    /activatePairingCode\s*\(/,
    /auth\/v1\/user/,
    /createServerClient\s*\(/,
    /createClient\s*\(/, // sessão cookie (@/lib/supabase/server) na própria rota
    /\.auth\.getUser\s*\(/,
];

/**
 * Rotas com createAdmin intencional sem gate de sessão/HMAC
 * (já cobertas no inventário — ex.: health/uptime).
 * Paths relativos à raiz do repo, com `/`.
 */
export const CREATE_ADMIN_GATE_ALLOWLIST: readonly string[] = [
    "app/api/health/route.ts",
];

export function routeUsesCreateAdmin(src: string): boolean {
    return /createAdminClient\s*\(/.test(src) || /from\s+["']@\/lib\/supabase\/admin["']/.test(src);
}

export function routeHasRecognizedGate(src: string): boolean {
    return CREATE_ADMIN_GATE_PATTERNS.some((re) => re.test(src));
}

export function isCreateAdminGateAllowlisted(relPath: string): boolean {
    const norm = relPath.replace(/\\/g, "/");
    return CREATE_ADMIN_GATE_ALLOWLIST.some((a) => norm === a || norm.endsWith("/" + a));
}
