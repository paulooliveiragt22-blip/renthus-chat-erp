/**
 * POST /api/billing/payment-methods
 *
 * Ações: set_default (card_id do customer Pagar.me da company).
 * Lista de cartões continua em GET /api/billing/status.
 */

import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { jsonAccessError } from "@/lib/api/errors";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { listCustomerCards } from "@/lib/billing/pagarme";

export const runtime = "nodejs";

const RL_LIMIT = 20;
const RL_WINDOW_MS = 60_000;

export async function POST(req: Request) {
    try {
        const ctx = await requireCompanyAccess({
            allowedRoles: ["owner", "admin"],
            billing: "billing_self",
        });
        if (!ctx.ok) return jsonAccessError(ctx);

        const rl = checkRateLimit(`billing_pm:${ctx.companyId}`, RL_LIMIT, RL_WINDOW_MS);
        if (!rl.allowed) {
            return NextResponse.json(
                { error: "Muitas tentativas. Aguarde um momento." },
                { status: 429 }
            );
        }

        const body = (await req.json()) as { action?: string; card_id?: string };
        const action = body.action?.trim();
        const cardId = body.card_id?.trim() ?? "";

        if (action !== "set_default") {
            return NextResponse.json(
                { error: "Ação inválida. Use action=set_default." },
                { status: 400 }
            );
        }
        if (!cardId || cardId.length > 64) {
            return NextResponse.json({ error: "card_id inválido" }, { status: 400 });
        }

        const { admin, companyId } = ctx;
        const { data: sub, error: subErr } = await admin
            .from("pagarme_subscriptions")
            .select("id, pagarme_customer_id")
            .eq("company_id", companyId)
            .maybeSingle();

        if (subErr || !sub?.id) {
            return NextResponse.json({ error: "Assinatura não encontrada" }, { status: 404 });
        }

        const customerId = sub.pagarme_customer_id?.trim();
        if (!customerId) {
            return NextResponse.json(
                { error: "Cliente Pagar.me ainda não vinculado. Pague com cartão uma vez." },
                { status: 400 }
            );
        }

        const cards = await listCustomerCards(customerId);
        const owned = cards.some((c) => c.id === cardId);
        if (!owned) {
            return NextResponse.json(
                { error: "Cartão não pertence a esta empresa." },
                { status: 403 }
            );
        }

        const { error: updErr } = await admin
            .from("pagarme_subscriptions")
            .update({ default_card_id: cardId })
            .eq("id", sub.id);

        if (updErr) {
            return NextResponse.json({ error: updErr.message }, { status: 500 });
        }

        return NextResponse.json({
            ok: true,
            default_card_id: cardId,
            message: "Cartão padrão atualizado. Renovações tentarão este cartão primeiro.",
        });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unexpected error";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
