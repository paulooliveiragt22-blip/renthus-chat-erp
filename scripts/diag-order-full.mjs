/**
 * Dump order + customer address presence (redacted) for sandbox diagnosis.
 * Usage: node scripts/diag-order-full.mjs <order_id>
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

const sk = process.env.PAGARME_API_KEY?.trim();
const orderId = process.argv[2];
if (!sk || !orderId) {
  console.error("Usage: node scripts/diag-order-full.mjs <order_id> (needs PAGARME_API_KEY)");
  process.exit(1);
}

const auth = Buffer.from(`${sk}:`).toString("base64");

async function get(path) {
  const res = await fetch(`https://api.pagar.me/core/v5${path}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { http: res.status, json };
}

const order = await get(`/orders/${orderId}`);
const charge = order.json?.charges?.[0];
const tx = charge?.last_transaction;
const customerId = order.json?.customer?.id ?? charge?.customer?.id;
const cardId = tx?.card?.id;

const customer = customerId ? await get(`/customers/${customerId}`) : null;
const card = customerId && cardId ? await get(`/customers/${customerId}/cards/${cardId}`) : null;

console.log(
  JSON.stringify(
    {
      order_http: order.http,
      order_id: order.json?.id,
      order_status: order.json?.status,
      amount: order.json?.amount,
      charge_status: charge?.status,
      charge_amount: charge?.amount,
      tx_status: tx?.status,
      tx_success: tx?.success,
      status_reason: tx?.status_reason ?? null,
      acquirer_message: tx?.acquirer_message ?? null,
      acquirer_return_code: tx?.acquirer_return_code ?? null,
      gateway_response: tx?.gateway_response ?? null,
      antifraud_response: tx?.antifraud_response ?? null,
      card_on_tx: tx?.card
        ? {
            id: tx.card.id,
            brand: tx.card.brand,
            first6: tx.card.first_six_digits,
            last4: tx.card.last_four_digits,
            holder_document: tx.card.holder_document,
            billing_address: tx.card.billing_address ?? null,
          }
        : null,
      customer: customer
        ? {
            http: customer.http,
            id: customer.json?.id,
            name: customer.json?.name,
            email: customer.json?.email,
            document: customer.json?.document,
            document_type: customer.json?.document_type,
            type: customer.json?.type,
            address: customer.json?.address ?? null,
            phones: customer.json?.phones ?? null,
          }
        : null,
      card_resource: card
        ? {
            http: card.http,
            id: card.json?.id,
            status: card.json?.status,
            billing_address: card.json?.billing_address ?? null,
            error: card.json?.message ?? card.json?.errors ?? null,
          }
        : null,
    },
    null,
    2,
  ),
);
