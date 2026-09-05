/**
 * POST /api/billing/payment-methods
 *
 * set_default | add_card (tokeniza no browser → salva no customer Pagar.me).
 * Lista continua em GET /api/billing/status.
 */

import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { jsonAccessError } from "@/lib/api/errors";
import { checkRateLimit } from "@/lib/security/rateLimit";
import {
    createCustomer,
    createCustomerCard,
    listCustomerCards,
} from "@/lib/billing/pagarme";

export const runtime = "nodejs";

const RL_LIMIT = 20;
const RL_WINDOW_MS = 60_000;

type AddCardBody = {
    action?: string;
    card_id?: string;
    card_token?: string;
    set_as_default?: boolean;
    billing_address?: {
        cep?: string;
        endereco?: string;
        numero?: string;
        bairro?: string;
        cidade?: string;
        uf?: string;
    };
};

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

        const body = (await req.json()) as AddCardBody;
        const action = body.action?.trim();
        const { admin, companyId } = ctx;

        if (action === "add_card") {
            const cardToken = body.card_token?.trim() ?? "";
            if (!cardToken || cardToken.length > 200) {
                return NextResponse.json({ error: "card_token inválido" }, { status: 400 });
            }

            const { data: sub, error: subErr } = await admin
                .from("pagarme_subscriptions")
                .select("id, pagarme_customer_id")
                .eq("company_id", companyId)
                .maybeSingle();
            if (subErr || !sub?.id) {
                return NextResponse.json({ error: "Assinatura não encontrada" }, { status: 404 });
            }

            const { data: company } = await admin
                .from("companies")
                .select("name, nome_fantasia, email, cnpj, whatsapp_phone, phone")
                .eq("id", companyId)
                .maybeSingle();

            let customerId = sub.pagarme_customer_id?.trim() || "";
            if (!customerId) {
                const name =
                    String(company?.nome_fantasia || company?.name || "Empresa").trim() ||
                    "Empresa";
                const email =
                    String(company?.email || "").trim() || `billing+${companyId.slice(0, 8)}@renthus.local`;
                const created = await createCustomer({
                    name,
                    email,
                    document: company?.cnpj ? String(company.cnpj) : undefined,
                    phone: String(company?.whatsapp_phone || company?.phone || "").trim() || undefined,
                });
                customerId = String(created.id ?? "").trim();
                if (!customerId) {
                    return NextResponse.json(
                        { error: "Não foi possível criar o cliente no Pagar.me." },
                        { status: 502 }
                    );
                }
                await admin
                    .from("pagarme_subscriptions")
                    .update({
                        pagarme_customer_id: customerId,
                        updated_at: new Date().toISOString(),
                    })
                    .eq("id", sub.id);
            }

            const addr = body.billing_address;
            const street = String(addr?.endereco ?? "").trim();
            const number = String(addr?.numero ?? "").trim();
            const neighborhood = String(addr?.bairro ?? "").trim();
            const zip = String(addr?.cep ?? "").replaceAll(/\D/g, "");
            const city = String(addr?.cidade ?? "").trim();
            const uf = String(addr?.uf ?? "").trim().toUpperCase().slice(0, 2);

            let billingAddress:
                | {
                      line_1: string;
                      zip_code: string;
                      city: string;
                      state: string;
                      country?: string;
                  }
                | undefined;
            if (street && number && zip.length === 8 && city && uf.length === 2) {
                billingAddress = {
                    line_1: [street, number, neighborhood].filter(Boolean).join(", "),
                    zip_code: zip,
                    city,
                    state: uf,
                    country: "BR",
                };
            }

            let card;
            try {
                card = await createCustomerCard({
                    customerId,
                    cardToken,
                    billingAddress,
                });
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : "Falha ao salvar cartão.";
                return NextResponse.json({ error: msg }, { status: 400 });
            }

            const newId = String(card.id ?? "").trim();
            if (body.set_as_default !== false && newId) {
                await admin
                    .from("pagarme_subscriptions")
                    .update({
                        default_card_id: newId,
                        updated_at: new Date().toISOString(),
                    })
                    .eq("id", sub.id);
            }

            return NextResponse.json({
                ok: true,
                card: {
                    id: newId,
                    brand: card.brand ?? "",
                    last_four: card.last_four_digits ?? "",
                    holder: card.holder_name ?? "",
                    exp:
                        card.exp_month && card.exp_year
                            ? `${String(card.exp_month).padStart(2, "0")}/${card.exp_year}`
                            : "",
                },
                message: "Cartão adicionado com sucesso.",
            });
        }

        if (action !== "set_default") {
            return NextResponse.json(
                { error: "Ação inválida. Use action=set_default ou add_card." },
                { status: 400 }
            );
        }

        const cardId = body.card_id?.trim() ?? "";
        if (!cardId || cardId.length > 64) {
            return NextResponse.json({ error: "card_id inválido" }, { status: 400 });
        }

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
                { error: "Cliente Pagar.me ainda não vinculado. Adicione um cartão primeiro." },
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
