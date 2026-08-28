#!/usr/bin/env node
/**
 * Smoke Pagar.me sandbox — cartão + PIX (API direta, sem sessão Renthus).
 *
 * Valida chaves sk_test/pk_test e simuladores antes do teste manual em /plano/pagar.
 *
 * Uso:
 *   node scripts/billing-sandbox-smoke.mjs
 *   node scripts/billing-sandbox-smoke.mjs --amount-cents 19700
 *
 * Requer em .env.local (ou env):
 *   PAGARME_API_KEY=sk_test_...
 *   NEXT_PUBLIC_PAGARME_PUBLIC_KEY=pk_test_...
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "https://api.pagar.me/core/v5";
const TEST_CARD = "4000000000000010";
const TEST_CVV = "123";
const TEST_EXP_MONTH = 12;
const TEST_EXP_YEAR = 30;
const DEFAULT_AMOUNT_CENTS = 19700; // Essencial mensal — < R$500 (PIX sandbox ok)

function loadDotEnvLocal() {
    const p = resolve(process.cwd(), ".env.local");
    try {
        const raw = readFileSync(p, "utf8");
        for (const line of raw.split(/\r?\n/)) {
            const t = line.trim();
            if (!t || t.startsWith("#")) continue;
            const idx = t.indexOf("=");
            if (idx <= 0) continue;
            const key = t.slice(0, idx).trim();
            let val = t.slice(idx + 1).trim();
            if (
                (val.startsWith('"') && val.endsWith('"')) ||
                (val.startsWith("'") && val.endsWith("'"))
            ) {
                val = val.slice(1, -1);
            }
            if (!process.env[key]) process.env[key] = val;
        }
    } catch {
        /* optional */
    }
}

function parseArgs() {
    const args = process.argv.slice(2);
    let amountCents = DEFAULT_AMOUNT_CENTS;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--amount-cents" && args[i + 1]) {
            amountCents = Math.max(100, parseInt(args[i + 1], 10) || DEFAULT_AMOUNT_CENTS);
            i++;
        }
    }
    return { amountCents };
}

function requireEnv(name) {
    const v = process.env[name]?.trim();
    if (!v) {
        console.error(`[billing-sandbox] ${name} ausente. Adicione em .env.local (sk_test_/pk_test_).`);
        process.exit(1);
    }
    if (name === "PAGARME_API_KEY" && !v.startsWith("sk_test_")) {
        console.warn(`[billing-sandbox] AVISO: ${name} não parece sandbox (esperado sk_test_).`);
    }
    if (name === "NEXT_PUBLIC_PAGARME_PUBLIC_KEY" && !v.startsWith("pk_test_")) {
        console.warn(`[billing-sandbox] AVISO: ${name} não parece sandbox (esperado pk_test_).`);
    }
    return v;
}

function basicAuth(secretKey) {
    return "Basic " + Buffer.from(`${secretKey}:`).toString("base64");
}

async function pagarme(secretKey, path, method, body) {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
            Authorization: basicAuth(secretKey),
            "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = json?.message ?? `HTTP ${res.status}`;
        throw new Error(`${path}: ${msg} — ${JSON.stringify(json)}`);
    }
    return json;
}

async function createCardToken(publicKey) {
    const res = await fetch(
        `${BASE}/tokens?appId=${encodeURIComponent(publicKey)}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                type: "card",
                card: {
                    number: TEST_CARD,
                    holder_name: "Sandbox Renthus",
                    exp_month: TEST_EXP_MONTH,
                    exp_year: TEST_EXP_YEAR,
                    cvv: TEST_CVV,
                    billing_address: {
                        street: "Rua Teste",
                        number: "100",
                        neighborhood: "Centro",
                        zipcode: "01310100",
                        city: "Sao Paulo",
                        state: "SP",
                        country: "BR",
                    },
                },
            }),
        }
    );
    const json = await res.json();
    if (!res.ok || !json?.id) {
        throw new Error(`token: ${json?.message ?? res.status}`);
    }
    return json.id;
}

function orderChargeStatus(order) {
    return order?.charges?.[0]?.status ?? order?.status ?? "unknown";
}

async function testCreditCard(secretKey, publicKey, amountCents) {
    console.log("\n── Cartão de crédito (simulador PSP) ──");
    const token = await createCardToken(publicKey);
    console.log("  token OK");

    const order = await pagarme(secretKey, "/orders", "POST", {
        items: [
            {
                amount: amountCents,
                description: "Smoke Renthus sandbox — cartão",
                quantity: 1,
                code: "smoke-card",
            },
        ],
        customer: {
            name: "Loja Sandbox Renthus",
            email: "sandbox+billing@renthus.test",
            type: "company",
            document: "12345678000199",
            document_type: "CNPJ",
            phones: {
                mobile_phone: { country_code: "55", area_code: "11", number: "999999999" },
            },
            address: {
                line_1: "100, Rua Teste, Centro",
                zip_code: "01310100",
                city: "Sao Paulo",
                state: "SP",
                country: "BR",
            },
        },
        payments: [
            {
                payment_method: "credit_card",
                amount: amountCents,
                credit_card: {
                    installments: 1,
                    card_token: token,
                    operation_type: "auth_and_capture",
                    card: {
                        billing_address: {
                            line_1: "100, Rua Teste, Centro",
                            zip_code: "01310100",
                            city: "Sao Paulo",
                            state: "SP",
                            country: "BR",
                        },
                    },
                },
            },
        ],
        metadata: { type: "smoke", channel: "billing-sandbox-smoke" },
    });

    const st = orderChargeStatus(order);
    console.log(`  order_id=${order.id} charge_status=${st}`);
    if (st !== "paid") {
        throw new Error(`cartão esperava paid, recebeu ${st}`);
    }
    console.log("  PASS cartão");
    return order.id;
}

async function testPix(secretKey, amountCents) {
    console.log("\n── PIX (simulador — auto-paga em segundos se valor ≤ R$500) ──");
    const order = await pagarme(secretKey, "/orders", "POST", {
        items: [
            {
                amount: amountCents,
                description: "Smoke Renthus sandbox — PIX",
                quantity: 1,
                code: "smoke-pix",
            },
        ],
        customer: {
            name: "Loja Sandbox Renthus",
            email: "sandbox+pix@renthus.test",
            type: "company",
            document: "12345678000199",
            document_type: "CNPJ",
        },
        payments: [
            {
                payment_method: "pix",
                amount: amountCents,
                pix: { expires_in: 3600 },
            },
        ],
        metadata: { type: "smoke", channel: "billing-sandbox-smoke" },
    });

    let st = orderChargeStatus(order);
    console.log(`  order_id=${order.id} charge_status inicial=${st}`);

    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
        if (st === "paid") break;
        await new Promise((r) => setTimeout(r, 2000));
        const refreshed = await pagarme(secretKey, `/orders/${order.id}`, "GET");
        st = orderChargeStatus(refreshed);
        process.stdout.write(".");
    }
    console.log(`\n  charge_status final=${st}`);
    if (st !== "paid") {
        throw new Error(`PIX esperava paid em ≤45s, recebeu ${st}`);
    }
    console.log("  PASS PIX");
    return order.id;
}

async function main() {
    loadDotEnvLocal();
    const { amountCents } = parseArgs();
    const secretKey = requireEnv("PAGARME_API_KEY");
    const publicKey = requireEnv("NEXT_PUBLIC_PAGARME_PUBLIC_KEY");

    console.log("[billing-sandbox] Pagar.me sandbox smoke");
    console.log(`  amount_cents=${amountCents} (R$ ${(amountCents / 100).toFixed(2)})`);

    const cardOrderId = await testCreditCard(secretKey, publicKey, amountCents);
    const pixOrderId = await testPix(secretKey, amountCents);

    console.log("\n[billing-sandbox] OK — cartão e PIX aprovados no simulador.");
    console.log(`  card_order=${cardOrderId}`);
    console.log(`  pix_order=${pixOrderId}`);
    console.log("\nPróximo passo: teste E2E em /plano/pagar (ver docs/SMOKE_BILLING_PAGARME_SANDBOX.md).");
}

main().catch((e) => {
    console.error("\n[billing-sandbox] FALHOU:", e instanceof Error ? e.message : e);
    process.exit(1);
});
