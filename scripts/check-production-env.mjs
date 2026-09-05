#!/usr/bin/env node
/**
 * Verifica variáveis críticas em produção.
 * Uso: VERCEL_ENV=production node scripts/check-production-env.mjs
 *      node scripts/check-production-env.mjs --strict
 */

const strict =
    process.argv.includes("--strict") ||
    process.env.VERCEL_ENV === "production";

if (!strict) {
    console.log("[check-production-env] Ignorado (use --strict ou VERCEL_ENV=production).");
    process.exit(0);
}

const required = [
    "CRON_SECRET",
    "SUPABASE_SERVICE_ROLE_KEY",
    "WHATSAPP_APP_SECRET",
    "PAGARME_API_KEY",
];

const missing = required.filter((k) => !process.env[k]?.trim());
if (missing.length) {
    console.error("[check-production-env] Variáveis ausentes:", missing.join(", "));
    process.exit(1);
}

// Pagar.me Core v5: L1 = Basic Auth do hookset (não HMAC).
const basicUser = process.env.PAGARME_WEBHOOK_BASIC_USER?.trim();
const basicPass = process.env.PAGARME_WEBHOOK_BASIC_PASSWORD?.trim();
if (!basicUser || !basicPass) {
    console.error(
        "[check-production-env] Faltam PAGARME_WEBHOOK_BASIC_USER e/ou PAGARME_WEBHOOK_BASIC_PASSWORD (Basic Auth do painel Pagar.me)."
    );
    process.exit(1);
}
console.log(
    "[check-production-env] PAGARME_WEBHOOK_BASIC_* set — webhook exige Authorization Basic em produção."
);
if (process.env.PAGARME_WEBHOOK_SECRET?.trim()) {
    console.log(
        "[check-production-env] PAGARME_WEBHOOK_SECRET set (legado) — só valida se X-Hub-Signature vier."
    );
}

if (!process.env.PLATFORM_ADMIN_IP_ALLOWLIST?.trim()) {
    console.warn(
        "[check-production-env] Aviso: PLATFORM_ADMIN_IP_ALLOWLIST ausente — /platform bloqueado em produção."
    );
}

if (!process.env.PLATFORM_ADMIN_HOST?.trim()) {
    console.warn(
        "[check-production-env] Aviso: PLATFORM_ADMIN_HOST ausente — console platform no mesmo host do tenant (ok até ter DNS dedicado)."
    );
}

if (process.env.SQS_DISPATCH_ENABLED?.trim() !== "1") {
    console.error(
        "[check-production-env] SQS_DISPATCH_ENABLED deve ser 1 em produção (ADR-0003 cutover)."
    );
    process.exit(1);
}
const sqsRequired = [
    "AWS_REGION",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "SQS_INBOUND_QUEUE_URL",
    "SQS_OUTBOUND_QUEUE_URL",
];
const sqsMissing = sqsRequired.filter((k) => !process.env[k]?.trim());
if (sqsMissing.length) {
    console.error(
        "[check-production-env] SQS_DISPATCH_ENABLED=1 mas faltam:",
        sqsMissing.join(", ")
    );
    process.exit(1);
}

const upstashUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
if (!upstashUrl || !upstashToken) {
    console.error(
        "[check-production-env] Faltam UPSTASH_REDIS_REST_URL e/ou UPSTASH_REDIS_REST_TOKEN — rate limit in-memory por réplica não vale em produção (S12 / INFRA-1)."
    );
    process.exit(1);
}
console.log("[check-production-env] Upstash Redis configurado (rate limit distribuído).");

console.log("[check-production-env] OK — variáveis obrigatórias definidas.");
