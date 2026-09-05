/**
 * POST /api/billing/self-reactivate
 *
 * Permite que um owner reative sua subscription abandonada via link direto
 * (/plano/reativar). Chama o RPC `rpc_self_reactivate_subscription`.
 *
 * O RPC faz (server-side):
 *   1. Valida que o usuário é owner da empresa (auth.uid via RLS)
 *   2. Valida que a subscription está em status abandoned/blocked/cancelled
 *   3. Valida cooldown (60 dias entre reativações)
 *   4. Transição: abandoned → trial (novo período de teste)
 *   5. Reativa companies.is_active = true
 *   6. Incrementa self_reactivation_count
 *
 * Retorna o trial_ends_at da nova tentativa.
 */

import { NextResponse } from "next/server";
import { billingLog } from "@/lib/billing/billingLog";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { jsonAccessError } from "@/lib/api/errors";

export const runtime = "nodejs";

export async function POST(req: Request) {
    const ctx = await requireCompanyAccess({
        allowedRoles: ["owner"],
        billing: "skip",
    });
    if (!ctx.ok) return jsonAccessError(ctx);

    const { admin, companyId, userId } = ctx;

    let body: { planKey?: string };
    try {
        body = await req.json();
    } catch {
        body = {};
    }

    const planKey = body.planKey ?? null;

    try {
        // RPC só para service_role; owner validado aqui (cookie workspace + role).
        const { data: trialEndsAt, error: rpcErr } = await admin.rpc(
            "rpc_self_reactivate_subscription",
            {
                p_company_id: companyId,
                p_plan_key:   planKey,
                p_caller_user_id: userId,
            }
        );

        if (rpcErr) {
            // O RPC pode retornar erros como:
            // "unauthenticated" → 401
            // "forbidden: not_owner" → 403
            // "subscription_not_found" → 404
            // "invalid_status_for_reactivation" → 422
            // "reactivation_cooldown_active" → 429
            const msg = String(rpcErr.message ?? "");
            if (msg.includes("unauthenticated")) {
                return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
            }
            if (msg.includes("not_owner")) {
                return NextResponse.json(
                    { error: "Você não tem permissão para reativar esta empresa" },
                    { status: 403 }
                );
            }
            if (msg.includes("subscription_not_found")) {
                return NextResponse.json(
                    { error: "Subscription não encontrada" },
                    { status: 404 }
                );
            }
            if (msg.includes("invalid_status")) {
                return NextResponse.json(
                    { error: `Status atual não permite reativação: ${msg}` },
                    { status: 422 }
                );
            }
            if (msg.includes("cooldown")) {
                return NextResponse.json(
                    { error: "Cooldown ativo. Aguarde 60 dias entre reativações.", retryAfter: "60 dias" },
                    { status: 429 }
                );
            }
            console.error("[self-reactivate] RPC error:", rpcErr.message);
            return NextResponse.json(
                { error: `Erro na reativação: ${rpcErr.message}` },
                { status: 500 }
            );
        }

        // Sucesso — RPC retorna o novo trial_ends_at
        billingLog("self-reactivate", "self_reactivated", {
            companyId,
            trialEndsAt: trialEndsAt as string,
        });

        const trialEnd = new Date(trialEndsAt as string);
        return NextResponse.json({
            ok: true,
            trialEndsAt: trialEndsAt as string,
            message: `Período de teste reativado até ${trialEnd.toLocaleDateString("pt-BR")}. Complete o pagamento em /plano/pagar para manter o acesso.`,
            redirectTo: "/plano/pagar",
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[self-reactivate] Exceção:", msg);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
