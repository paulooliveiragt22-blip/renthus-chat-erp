/**
 * Lê last_transaction de orders PIX já criados (só GET).
 * Uso: node scripts/diag-pix-fail-reason.mjs [order_id...]
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

const auth = "Basic " + Buffer.from(`${key}:`).toString("base64");
const ids = process.argv.slice(2);
const targets =
    ids.length > 0
        ? ids
        : ["or_Nv0DgKNIJntVZd2R", "or_K8A1eX3tWIpn9xML", "or_g8GyrQgID1UAMqJ1"];

for (const id of targets) {
    const res = await fetch(`https://api.pagar.me/core/v5/orders/${encodeURIComponent(id)}`, {
        headers: { Authorization: auth },
    });
    const j = await res.json().catch(() => ({}));
    const ch = j.charges?.[0];
    const tx = ch?.last_transaction ?? {};
    console.log(
        JSON.stringify(
            {
                id,
                http: res.status,
                order_status: j.status,
                charge_status: ch?.status,
                amount: ch?.amount ?? j.amount,
                tx_status: tx.status,
                tx_success: tx.success,
                qr_len: String(tx.qr_code ?? "").length,
                qr_url: tx.qr_code_url ?? null,
                gateway_response: tx.gateway_response ?? null,
                acquirer_message: tx.acquirer_message ?? null,
                acquirer_return_code: tx.acquirer_return_code ?? null,
                gateway_id: tx.gateway_id ?? null,
                transaction_type: tx.transaction_type ?? null,
            },
            null,
            2
        )
    );
}
