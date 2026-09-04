/**
 * Agenda downgrade para fim do ciclo (BN-12 / R3-4).
 *
 * A validação (rank, ciclo, keep-users, ≥1 admin, seat cap do destino) e a
 * escrita são feitas NO BANCO por rpc_schedule_downgrade (ADR-0006 D11 /
 * governanca Regra 2). Este módulo só traduz erros do banco para mensagens
 * pt-BR + HTTP status. A spec pura vive em validateKeepUserSelection.ts (espelho
 * de teste); a fonte de verdade em runtime é a RPC.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
    parseCommercialPlanInput,
    type CommercialPlanKey,
} from "@/lib/billing/planCatalog";

export type ScheduleDowngradeResult =
    | {
          ok: true;
          action: "scheduled";
          pending_plan_key: CommercialPlanKey;
          pending_plan_change_at: string;
          keep_user_ids: string[];
      }
    | { ok: false; error: string; status: number };

function mapDowngradeError(raw: string): { error: string; status: number } {
    const m = String(raw ?? "").toLowerCase();
    if (m.includes("subscription_not_found")) {
        return { error: "Assinatura não encontrada.", status: 404 };
    }
    if (m.includes("not_active")) {
        return { error: "Downgrade agendado só para assinatura ativa.", status: 400 };
    }
    if (m.includes("use_upgrade_flow")) {
        return { error: "Use o fluxo de upgrade para subir de plano.", status: 400 };
    }
    if (m.includes("no_next_billing")) {
        return {
            error: "Sem data de próximo vencimento — não é possível agendar.",
            status: 400,
        };
    }
    if (m.includes("need_at_least_one_admin")) {
        return { error: "A seleção deve incluir pelo menos 1 admin ou owner.", status: 400 };
    }
    if (m.includes("selection_invalid")) {
        return {
            error: "Seleção inválida: usuário inativo ou de outra empresa.",
            status: 400,
        };
    }
    const upTo = m.match(/select_up_to_(\d+) users \((\d+) active\)/);
    if (upTo) {
        return {
            error: `Selecione até ${upTo[1]} usuário(s) para manter (há ${upTo[2]} ativos).`,
            status: 400,
        };
    }
    const atMost = m.match(/select_at_most_(\d+) users/);
    if (atMost) {
        return {
            error: `Selecione no máximo ${atMost[1]} usuário(s) para o plano destino.`,
            status: 400,
        };
    }
    if (m.includes("plan_invalid") || m.includes("current_plan_invalid")) {
        return { error: "Plano inválido.", status: 400 };
    }
    return { error: raw, status: 500 };
}

export async function scheduleDowngrade(
    admin: SupabaseClient,
    companyId: string,
    input: { plan: string; keep_user_ids?: string[] }
): Promise<ScheduleDowngradeResult> {
    const target = parseCommercialPlanInput(input.plan);
    if (!target) {
        return { ok: false, error: "Plano inválido.", status: 400 };
    }

    const { data, error } = await admin.rpc("rpc_schedule_downgrade", {
        p_company_id: companyId,
        p_target_plan: target,
        p_keep_user_ids: Array.isArray(input.keep_user_ids) ? input.keep_user_ids : [],
    });

    if (error) {
        const mapped = mapDowngradeError(error.message);
        return { ok: false, ...mapped };
    }

    const r = (data ?? {}) as {
        pending_plan_key?: string;
        pending_plan_change_at?: string;
        keep_user_ids?: string[];
    };

    return {
        ok: true,
        action: "scheduled",
        pending_plan_key: (r.pending_plan_key as CommercialPlanKey) ?? target,
        pending_plan_change_at: String(r.pending_plan_change_at ?? ""),
        keep_user_ids: Array.isArray(r.keep_user_ids) ? r.keep_user_ids : [],
    };
}

export async function cancelPendingPlanChange(
    admin: SupabaseClient,
    companyId: string
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
    const { error } = await admin.rpc("rpc_cancel_pending_plan_change", {
        p_company_id: companyId,
    });
    if (error) {
        const m = String(error.message ?? "").toLowerCase();
        if (m.includes("subscription_not_found")) {
            return { ok: false, error: "Assinatura não encontrada.", status: 404 };
        }
        if (m.includes("no_scheduled_change")) {
            return { ok: false, error: "Não há downgrade agendado.", status: 400 };
        }
        return { ok: false, error: error.message, status: 500 };
    }
    return { ok: true };
}

// re-export puro (spec de cobrança usada por outros módulos)
export { effectiveChargePlanKey } from "@/lib/billing/validateKeepUserSelection";
