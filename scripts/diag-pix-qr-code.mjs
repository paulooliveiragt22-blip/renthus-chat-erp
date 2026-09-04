/**
 * Diagnóstico: qr_code PIX ainda Mundipagg?
 * Uso: node scripts/diag-pix-qr-code.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnvFile(relPath) {
    const p = resolve(process.cwd(), relPath);
    if (!existsSync(p)) return;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const i = t.indexOf("=");
        if (i <= 0) continue;
        const k = t.slice(0, i).trim();
        let v = t.slice(i + 1).trim();
        if (
            (v.startsWith('"') && v.endsWith('"')) ||
            (v.startsWith("'") && v.endsWith("'"))
        ) {
            v = v.slice(1, -1);
        }
        if (!process.env[k]) process.env[k] = v;
    }
}

loadDotEnvFile(".env.local");
loadDotEnvFile(".env.pagarme.local");

const key = process.env.PAGARME_API_KEY?.trim();
if (!key) {
    console.error("PAGARME_API_KEY ausente (.env.local ou .env.pagarme.local)");
    process.exit(1);
}

const BASE = "https://api.pagar.me/core/v5";
const auth = "Basic " + Buffer.from(`${key}:`).toString("base64");

async function pagarme(path, method = "GET", body) {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
            Authorization: auth,
            "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(`${path} HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    }
    return json;
}

function dump(label, order) {
    const tx = order?.charges?.[0]?.last_transaction ?? {};
    const qr = String(tx.qr_code ?? "");
    const url = String(tx.qr_code_url ?? "");
    const compact = qr.replace(/\s+/g, "");
    console.log(`\n== ${label}`);
    console.log(`  order=${order.id} charge=${order.charges?.[0]?.id} status=${order.charges?.[0]?.status}`);
    console.log(`  qr_code.length=${qr.length}`);
    console.log(`  qr_code.prefix=${qr.slice(0, 120)}`);
    console.log(`  qr_code_url=${url.slice(0, 180)}`);
    console.log(`  looks_mundipagg=${/mundipagg/i.test(qr) || /mundipagg/i.test(url)}`);
    console.log(
        `  looks_emv=${/^000201/.test(compact) && /br\.gov\.bcb\.pix/i.test(qr)}`
    );
    console.log(`  gateway_id=${tx.gateway_id ?? tx.gatewayId ?? null}`);
    console.log(
        `  acquirer/provider=${tx.acquirer_name ?? tx.brand ?? tx.provider ?? null}`
    );
}

const oldIds = ["or_g8GyrQgID1UAMqJ1", "or_DqmLPJ7S2UPOwBVd"];
for (const id of oldIds) {
    try {
        dump(`GET ${id}`, await pagarme(`/orders/${id}`));
    } catch (e) {
        console.log(`GET ${id} ERR`, e instanceof Error ? e.message.slice(0, 200) : e);
    }
}

const created = await pagarme("/orders", "POST", {
    items: [
        {
            amount: 19700,
            description: "Diag PIX EMV Renthus",
            quantity: 1,
            code: "diag-pix",
        },
    ],
    customer: {
        name: "Diag PIX Renthus",
        email: "diag+pix@renthus.test",
        type: "company",
        document: "11444777000161",
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
            payment_method: "pix",
            amount: 19700,
            pix: { expires_in: 3600 },
        },
    ],
    metadata: { purpose: "pix_emv_diag" },
});
dump("POST new", created);
