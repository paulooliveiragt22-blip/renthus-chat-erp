/**
 * POST /api/billing/create-invoice-checkout
 *
 * Mensalidade Renthus — PIX ou cartão (token no browser).
 * Exige sessão + workspace (owner/admin). Libera o plano na hora se o cartão for aprovado;
 * PIX / cartão em análise: webhook + sync sob demanda (status / reentrada no checkout).
 */

import { NextResponse }      from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { checkRateLimit } from "@/lib/security/rateLimit";
import {
    createPixInvoiceOrder,
    createSetupOrder,
    createOrderWithSavedCard,
    resolvePixFromOrder,
    getPagarmeOrder,
    extractOrderCustomerId,
    extractCardIdFromOrder,
    isOrderCreditPaid,
    listCustomerCards,
    updatePagarmeCustomer,
} from "@/lib/billing/pagarme";
import { fulfillPayment } from "@/lib/billing/fulfillPayment";
import { syncPendingObligationFromPsp } from "@/lib/billing/syncPendingObligationFromPsp";
import {
    buildPagarmeCustomerPayload,
    extractCompanyCnpjDigits,
} from "@/lib/billing/buildPagarmeCustomerFromCompany";
import {
    applyFiscalToPagarmeCustomer,
    PAGARME_INVALID_DOCUMENT_ERROR,
    resolvePagarmeFiscalDocument,
} from "@/lib/billing/pagarmeFiscalDocument";
import { getPlanLabel } from "@/lib/billing/planCatalog";
import { isUniqueViolation } from "@/lib/billing/isUniqueViolation";
import {
    loadCheckoutContext,
    checkoutOrderLabels,
} from "@/lib/billing/ensureCheckout";
import { isCheckoutIdempotencyFresh } from "@/lib/billing/checkoutIdempotency";
import { reconcileOrCancelLiveOrder } from "@/lib/billing/reconcileLivePagarmeOrder";

export const runtime = "nodejs";

const CREATE_INVOICE_CHECKOUT_RATE_LIMIT = 10;
const CREATE_INVOICE_CHECKOUT_RATE_WINDOW_MS = 60_000;

function resolveCheckoutIdempotencyKey(
    req: Request,
    body: { idempotency_key?: string }
): string | null {
    const fromHeader = req.headers.get("idempotency-key")?.trim() ?? "";
    const fromBody =
        typeof body.idempotency_key === "string" ? body.idempotency_key.trim() : "";
    const raw = fromHeader || fromBody;
    if (!raw || raw.length > 128) return null;
    return raw;
}

/** Só anexa order/PIX. Amount e kind já vieram de rpc_create_billing_obligation. */
async function attachPspToPendingInvoice(
    admin: ReturnType<typeof createAdminClient>,
    p: {
        invoiceId: string;
        orderId: string;
        pixUrl?: string | null;
        pixCode?: string | null;
    }
) {
    const { error } = await admin
        .from("invoices")
        .update({
            pagarme_order_id: p.orderId,
            pagarme_payment_url: p.pixUrl ?? "",
            pix_qr_code: p.pixCode ?? null,
        })
        .eq("id", p.invoiceId)
        .eq("status", "pending");
    if (error) throw error;
}

type Body = {
    payment_method?:  "pix" | "credit_card";
    card_token?:      string;
    /** Cartão já salvo no customer Pagar.me (retry / default). */
    card_id?:         string;
    installments?:    number;
    idempotency_key?: string;
    billing_address?: {
        cep:      string;
        endereco: string;
        numero:   string;
        bairro?:  string;
        cidade:   string;
        uf:       string;
    };
};

export async function POST(req: Request) {
    try {
        const ctx = await requireCompanyAccess({
            allowedRoles: ["owner", "admin"],
            billing: "billing_self",
        });
        if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

        const companyId = ctx.companyId;

        const rl = checkRateLimit(
            `billing_create_invoice_checkout:${companyId}`,
            CREATE_INVOICE_CHECKOUT_RATE_LIMIT,
            CREATE_INVOICE_CHECKOUT_RATE_WINDOW_MS
        );
        if (!rl.allowed) {
            return NextResponse.json(
                { error: "rate_limit_exceeded" },
                { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
            );
        }

        const body      = (await req.json().catch(() => ({}))) as Body;
        const paymentMethod =
            body.payment_method === "credit_card" ? "credit_card" : "pix";

        const admin = createAdminClient();
        const idemKey = resolveCheckoutIdempotencyKey(req, body);
        const idemRowId = idemKey ? `${companyId}:${idemKey}` : null;

        if (idemRowId) {
            const { data: cached } = await admin
                .from("billing_checkout_idempotency")
                .select("response, created_at")
                .eq("id", idemRowId)
                .maybeSingle();
            if (
                cached?.response &&
                typeof cached.response === "object" &&
                isCheckoutIdempotencyFresh(
                    typeof cached.created_at === "string" ? cached.created_at : null
                )
            ) {
                return NextResponse.json(cached.response as Record<string, unknown>);
            }
        }

        const remember = async (payload: Record<string, unknown>) => {
            if (idemRowId) {
                await admin.from("billing_checkout_idempotency").upsert(
                    {
                        id:         idemRowId,
                        company_id: companyId,
                        response:   payload,
                        created_at: new Date().toISOString(),
                    },
                    { onConflict: "id" }
                );
            }
            return NextResponse.json(payload);
        };

        const checkout = await loadCheckoutContext(admin, companyId);
        if ("error" in checkout) {
            return NextResponse.json({ error: checkout.error }, { status: checkout.status });
        }

        const { sub, strategy, pendingInv, pendingRecord } = checkout;
        const { isFirstPayment, amountCents } = strategy;
        const plan = sub.plan;

        // Já ativo no período pago: não abrir nova cobrança (evita multi-pay).
        const nextBillingMs = sub.next_billing_at
            ? Date.parse(sub.next_billing_at)
            : NaN;
        const prepaidActive =
            String(sub.status).toLowerCase() === "active" &&
            Number.isFinite(nextBillingMs) &&
            nextBillingMs > Date.now() &&
            !pendingRecord;
        if (prepaidActive) {
            return remember({
                ok: true,
                payment_status: "paid",
                already_paid: true,
                message: "Plano já está ativo. Nenhuma cobrança adicional agora.",
                next_billing_at: sub.next_billing_at,
            });
        }

        // Se já pagou no PSP e o webhook falhou: libera antes de reexibir QR / criar order.
        if (pendingRecord?.pagarme_order_id) {
            const sync = await syncPendingObligationFromPsp(admin, companyId);
            if (sync.action === "fulfilled") {
                return remember({
                    ok: true,
                    payment_method: paymentMethod,
                    payment_status: "paid",
                    message: "Pagamento confirmado. Plano liberado.",
                    psp_sync: sync,
                });
            }
        }

        const { data: company, error: compErr } = await admin
            .from("companies")
            .select(
                "name, nome_fantasia, email, whatsapp_phone, meta, cnpj, cep, endereco, numero, cidade, uf"
            )
            .eq("id", companyId)
            .maybeSingle();

        if (compErr || !company) {
            return NextResponse.json({ error: "Empresa não encontrada" }, { status: 404 });
        }

        const companyRow = {
            id:               companyId,
            name:             company.name as string | null,
            nome_fantasia:    company.nome_fantasia as string | null,
            email:            company.email as string | null,
            whatsapp_phone:   company.whatsapp_phone as string | null,
            cnpj:             company.cnpj as string | null,
            meta:             (company.meta as Record<string, unknown> | null) ?? null,
        };
        const customerBuilt = buildPagarmeCustomerPayload(companyRow);
        const fiscal = resolvePagarmeFiscalDocument(extractCompanyCnpjDigits(companyRow));
        if (!fiscal.ok) {
            return NextResponse.json({ error: PAGARME_INVALID_DOCUMENT_ERROR }, { status: 400 });
        }
        const customerBase = applyFiscalToPagarmeCustomer(customerBuilt, fiscal.value);
        let pagarmeCustomerId = sub.pagarme_customer_id?.trim() || undefined;
        if (pagarmeCustomerId) {
            try {
                await updatePagarmeCustomer({
                    customerId:    pagarmeCustomerId,
                    name:          customerBase.name,
                    email:         customerBase.email,
                    document:      fiscal.value.digits,
                    document_type: fiscal.value.document_type,
                    type:          fiscal.value.type,
                    phone:         customerBase.phone,
                });
            } catch (patchErr: unknown) {
                const patchMsg = patchErr instanceof Error ? patchErr.message : String(patchErr);
                console.warn("[create-invoice-checkout] PATCH customer document failed:", patchMsg);
                pagarmeCustomerId = undefined;
            }
        }
        // Customer PSP antigo com CNPJ inválido: order novo sem customer_id (fixture no payload).
        const reuseCustomerId =
            pagarmeCustomerId && !fiscal.value.usedSandboxFixture
                ? pagarmeCustomerId
                : undefined;

        const metaType = strategy.metaType;
        const targetPlanKey = String(pendingInv?.target_plan_key ?? "").trim();
        const orderMeta: Record<string, string> = {
            type: metaType,
            company_id: companyId,
            subscription_id: sub.id,
            plan: targetPlanKey || String(plan),
        };
        if (metaType === "plan_upgrade" && targetPlanKey) {
            orderMeta.from_plan = String(plan);
            orderMeta.to_plan = targetPlanKey;
        }
        if (pendingInv?.id) {
            orderMeta.invoice_id = pendingInv.id;
        }
        const planLabel = getPlanLabel(targetPlanKey || plan);
        const fromPlanLabel = getPlanLabel(plan);
        const labels = checkoutOrderLabels(strategy, planLabel, {
            fromPlanLabel,
            toPlanLabel: targetPlanKey ? getPlanLabel(targetPlanKey) : planLabel,
        });

        if (paymentMethod === "credit_card") {
            const token = body.card_token?.trim();
            const savedCardId = body.card_id?.trim();
            if (!token && !savedCardId) {
                return NextResponse.json(
                    { error: "Informe card_token (novo) ou card_id (salvo)." },
                    { status: 400 }
                );
            }

            // H4.2: cancel-before-create (ou fulfill se already paid)
            const cardRecon = await reconcileOrCancelLiveOrder(
                admin,
                pendingRecord?.pagarme_order_id,
                metaType
            );
            if (cardRecon.action === "fulfilled") {
                return remember({
                    ok: true,
                    payment_method: "credit_card",
                    payment_status: "paid",
                    message: "Pagamento confirmado. Plano liberado.",
                });
            }

            const installments = Math.max(1, Math.min(12, Number(body.installments) || 1));
            let order;
            let usedCardId: string | null = savedCardId || null;

            if (savedCardId) {
                const customerId = pagarmeCustomerId;
                if (!customerId) {
                    return NextResponse.json(
                        { error: "Cliente Pagar.me ausente ou com documento inválido. Cadastre um cartão novo." },
                        { status: 400 }
                    );
                }
                const cards = await listCustomerCards(customerId);
                if (!cards.some((c) => c.id === savedCardId)) {
                    return NextResponse.json(
                        { error: "Cartão não pertence a esta empresa." },
                        { status: 403 }
                    );
                }
                order = await createOrderWithSavedCard({
                    amountCents,
                    description: labels.description,
                    itemCode: labels.itemCode,
                    customerId,
                    cardId: savedCardId,
                    recurrence: !isFirstPayment,
                    metadata: orderMeta,
                });
            } else {
                const bodyAddr = body.billing_address;
                const street  = (bodyAddr?.endereco?.trim() || String(company.endereco ?? "")).trim();
                const num     = (bodyAddr?.numero?.trim()   || String(company.numero   ?? "")).trim();
                const bairro  = (bodyAddr?.bairro?.trim()   || String((company as { bairro?: string | null }).bairro ?? "")).trim();
                const city    = (bodyAddr?.cidade?.trim()   || String(company.cidade   ?? "")).trim();
                const uf      = (bodyAddr?.uf?.trim()       || String(company.uf       ?? "")).trim();
                let zip       = (bodyAddr?.cep ?? String(company.cep ?? "")).replaceAll(/\D/g, "");

                if (!street || !num || !city || uf.length < 2) {
                    return NextResponse.json(
                        { error: "Preencha o endereço de cobrança (endereço, número, cidade e UF) para pagar com cartão." },
                        { status: 400 }
                    );
                }
                if (zip.length > 0 && zip.length < 8) zip = zip.padStart(8, "0");
                if (zip.length < 8) {
                    return NextResponse.json(
                        { error: "CEP completo (8 dígitos) é obrigatório para pagamento com cartão." },
                        { status: 400 }
                    );
                }

                const line1Parts = [num, street, bairro].filter(Boolean);

                order = await createSetupOrder({
                    amountCents,
                    description:     labels.description,
                    installments,
                    cardToken:       token!,
                    itemCode:        labels.itemCode,
                    holderDocument:  fiscal.value.digits,
                    customerId:      reuseCustomerId,
                    customer:        reuseCustomerId ? undefined : customerBase,
                    billingAddress: {
                        line_1:   line1Parts.join(", "),
                        line_2:   "",
                        zip_code: zip,
                        city,
                        state:    uf.slice(0, 2).toUpperCase(),
                        country:  "BR",
                    },
                    metadata: orderMeta,
                });
                usedCardId = extractCardIdFromOrder(order);
            }

            const custId = extractOrderCustomerId(order);

            if (!pendingInv?.id) {
                return NextResponse.json(
                    { error: "obligation_missing" },
                    { status: 500 }
                );
            }
            await attachPspToPendingInvoice(admin, {
                invoiceId: pendingInv.id,
                orderId: order.id,
            });

            const subPatch: Record<string, unknown> = {};
            if (custId) subPatch.pagarme_customer_id = custId;
            if (usedCardId) subPatch.default_card_id = usedCardId;
            if (Object.keys(subPatch).length > 0) {
                await admin.from("pagarme_subscriptions").update(subPatch).eq("id", sub.id);
            }

            if (isOrderCreditPaid(order)) {
                await fulfillPayment(admin, {
                    id: order.id,
                    metadata: orderMeta as Record<string, string>,
                    customer: custId ? { id: custId } : undefined,
                });
                return remember({
                    ok:             true,
                    payment_method: "credit_card",
                    payment_status: "paid",
                    message:        "Pagamento aprovado. Plano liberado.",
                });
            }

            return remember({
                ok:             true,
                payment_method: "credit_card",
                payment_status: "pending",
                order_id:       order.id,
                message:        "Pagamento em análise. Quando o banco aprovar, o plano será liberado automaticamente.",
            });
        }

        // ── PIX ───────────────────────────────────────────────────────────
        const existingPixUrl  = pendingRecord?.pagarme_payment_url ?? null;
        const existingPixCode =
            (pendingRecord as { pix_qr_code?: string | null } | null)?.pix_qr_code ?? null;
        const hasHostedCheckout = existingPixUrl?.includes("checkout.pagar.me") ?? false;

        // Já tem order + EMV: reutiliza. Se só tem URL (sem copia-e-cola), tenta backfill.
        if (pendingRecord?.pagarme_order_id && existingPixUrl && !hasHostedCheckout) {
            if (existingPixCode) {
                return remember({
                    ok:             true,
                    payment_method: "pix",
                    pix_qr_url:     existingPixUrl,
                    pix_qr_code:    existingPixCode,
                });
            }
            try {
                const existingOrder = await getPagarmeOrder(pendingRecord.pagarme_order_id);
                const resolved = await resolvePixFromOrder(existingOrder);
                if (resolved.pixCode) {
                    const url = resolved.pixUrl ?? existingPixUrl;
                    if (pendingInv) {
                        await admin.from("invoices")
                            .update({
                                pix_qr_code:         resolved.pixCode,
                                pagarme_payment_url: url,
                            })
                            .eq("id", pendingInv.id);
                    }
                    return remember({
                        ok:             true,
                        payment_method: "pix",
                        pix_qr_url:     url,
                        pix_qr_code:    resolved.pixCode,
                    });
                }
            } catch (backfillErr) {
                console.warn("[create-invoice-checkout] PIX EMV backfill failed:", backfillErr);
            }
            // Sem EMV ainda: cai no fluxo de criar novo order abaixo (ou reutiliza URL só se
            // o usuário só precisar do QR imagem — preferimos regenerar com EMV).
        }

        const companyLabel = (company.nome_fantasia as string | null)?.trim()
            || (company.name as string | null)?.trim()
            || "Renthus";

        // Regenerar: fulfill se paid; senão cancela charge anterior (anti-órfão)
        if (pendingRecord?.pagarme_order_id) {
            const pixRecon = await reconcileOrCancelLiveOrder(
                admin,
                pendingRecord.pagarme_order_id,
                metaType
            );
            if (pixRecon.action === "fulfilled") {
                return remember({
                    ok: true,
                    payment_method: "pix",
                    payment_status: "paid",
                    message: "Pagamento confirmado. Plano liberado.",
                });
            }
        }

        const created = await createPixInvoiceOrder({
            amountCents,
            description: labels.description,
            itemCode:   labels.itemCode,
            customerId: reuseCustomerId,
            customer:   reuseCustomerId ? undefined : customerBase,
            additionalInfo: [
                { name: "Empresa", value: companyLabel },
                { name: "Tipo",    value: labels.tipoLabel },
            ],
            metadata: orderMeta,
        });

        const { order, pixCode, pixUrl, gatewayStub } = await resolvePixFromOrder(created);

        // ADR-0004 B3: vincular order_id local ANTES de falhar por EMV (anti-órfão)
        if (!pendingInv?.id) {
            return NextResponse.json({ error: "obligation_missing" }, { status: 500 });
        }
        try {
            await attachPspToPendingInvoice(admin, {
                invoiceId: pendingInv.id,
                orderId: order.id,
                pixUrl,
                pixCode: pixCode && String(pixCode).trim() ? pixCode : null,
            });
        } catch (persistErr: unknown) {
            const pe = persistErr as { code?: string; message?: string };
            if (!isUniqueViolation(pe)) throw persistErr;
            const { data: raceInv } = await admin
                .from("invoices")
                .select("pagarme_payment_url, pix_qr_code")
                .eq("company_id", companyId)
                .eq("status", "pending")
                .maybeSingle();
            if (raceInv?.pix_qr_code) {
                return remember({
                    ok:             true,
                    payment_method: "pix",
                    pix_qr_url:     raceInv.pagarme_payment_url,
                    pix_qr_code:    raceInv.pix_qr_code,
                });
            }
            throw persistErr;
        }

        if (!pixCode || !String(pixCode).trim()) {
            const message = gatewayStub
                ? "A conta Pagar.me devolveu QR legado (Mundipagg) sem código PIX copia-e-cola. No painel Pagar.me → Configurações → Meios de pagamento, ative PIX no gateway Pagar.me/Stone (não página Mundipagg) e tente de novo. Enquanto isso use cartão."
                : "Não foi possível obter o código PIX copia-e-cola. Tente novamente em alguns segundos.";
            return NextResponse.json(
                {
                    error: gatewayStub ? "pix_gateway_stub" : "pix_emv_unavailable",
                    message,
                    order_id: order.id,
                    pix_qr_url: pixUrl,
                },
                { status: 502 }
            );
        }

        return remember({
            ok:             true,
            payment_method: "pix",
            pix_qr_url:     pixUrl,
            pix_qr_code:    pixCode,
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[create-invoice-checkout] Erro:", msg);
        return NextResponse.json({ error: msg || "Erro interno" }, { status: 500 });
    }
}
