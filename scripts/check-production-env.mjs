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
    "PAGARME_WEBHOOK_SECRET",
];

const missing = required.filter((k) => !process.env[k]?.trim());
if (missing.length) {
    console.error("[check-production-env] Variáveis ausentes:", missing.join(", "));
    process.exit(1);
}

const upstashUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
if (!upstashUrl || !upstashToken) {
    console.warn(
        "[check-production-env] Aviso: UPSTASH_REDIS_REST_URL/TOKEN ausentes — rate limit fica só in-memory por réplica. Ver lib/security/rateLimitDistributed.ts"
    );
} else {
    console.log("[check-production-env] Upstash Redis configurado (rate limit distribuído).");
}

console.log("[check-production-env] OK — variáveis obrigatórias definidas.");
