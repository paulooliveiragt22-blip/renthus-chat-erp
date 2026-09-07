/**
 * Dump last_transaction completo de um order (GET only).
 * Uso: node scripts/diag-order-tx.mjs or_xxx
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
    console.error("PAGARME_API_KEY ausente");
    process.exit(1);
}
const id = process.argv[2];
if (!id) {
    console.error("Uso: node scripts/diag-order-tx.mjs or_xxx");
    process.exit(1);
}

const auth = "Basic " + Buffer.from(`${key}:`).toString("base64");
const res = await fetch(`https://api.pagar.me/core/v5/orders/${encodeURIComponent(id)}`, {
    headers: { Authorization: auth },
});
const j = await res.json();
const ch = j.charges?.[0] ?? {};
const tx = ch.last_transaction ?? {};
// Não logar PAN/CVV — só metadados de falha
const safeTx = { ...tx };
delete safeTx.card;
if (tx.card && typeof tx.card === "object") {
    safeTx.card = {
        brand: tx.card.brand,
        first_six_digits: tx.card.first_six_digits,
        last_four_digits: tx.card.last_four_digits,
        holder_name: tx.card.holder_name,
        holder_document: tx.card.holder_document ?? null,
        exp_month: tx.card.exp_month,
        exp_year: tx.card.exp_year,
        status: tx.card.status,
        card_keys: Object.keys(tx.card),
    };
}
const cust = j.customer ?? ch.customer ?? {};
console.log(
    JSON.stringify(
        {
            http: res.status,
            order_id: j.id,
            order_status: j.status,
            amount: j.amount,
            charge_status: ch.status,
            payment_method: ch.payment_method,
            installments: tx.installments ?? null,
            tx_status: tx.status,
            tx_success: tx.success,
            status_reason: tx.status_reason ?? null,
            acquirer_message: tx.acquirer_message ?? null,
            acquirer_return_code: tx.acquirer_return_code ?? null,
            acquirer_name: tx.acquirer_name ?? null,
            gateway_response: tx.gateway_response,
            antifraud_response: tx.antifraud_response,
            tx_keys: Object.keys(tx),
            customer: {
                id: cust.id ?? null,
                document: cust.document ?? null,
                document_type: cust.document_type ?? null,
                type: cust.type ?? null,
            },
            card: safeTx.card ?? null,
            metadata: j.metadata ?? null,
        },
        null,
        2
    )
);
