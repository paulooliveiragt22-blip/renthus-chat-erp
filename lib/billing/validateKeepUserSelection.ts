/**
 * Validação pura — seleção de users no downgrade (R3-4).
 */

import { normalizePlanKey } from "@/lib/billing/planCatalog";

export type KeepMember = {
    user_id: string;
    role: string;
    is_active: boolean;
};

export type ValidateKeepResult =
    | { ok: true; keep_user_ids: string[] }
    | { ok: false; error: string };

const ADMIN_ROLES = new Set(["owner", "admin"]);

/** Plano usado na cobrança renovação: pending se agendado. */
export function effectiveChargePlanKey(
    plan: string | null | undefined,
    pendingPlanKey: string | null | undefined
): string {
    const pending = normalizePlanKey(pendingPlanKey ?? null);
    if (pending) return pending;
    return normalizePlanKey(plan) ?? String(plan ?? "essencial");
}

export function validateKeepUserSelection(opts: {
    activeMembers: KeepMember[];
    targetIncludedSeats: number;
    keepUserIds: string[] | null | undefined;
}): ValidateKeepResult {
    const included = Math.max(1, Math.floor(opts.targetIncludedSeats));
    const active = opts.activeMembers.filter((m) => m.is_active);
    const activeIds = new Set(active.map((m) => m.user_id));

    if (active.length <= included) {
        // Sem excesso: keep = todos ativos (ou subset válido enviado).
        const requested = (opts.keepUserIds ?? []).filter((id) => activeIds.has(id));
        const keep = requested.length > 0 ? requested : [...activeIds];
        if (keep.length > included) {
            return {
                ok: false,
                error: `Selecione no máximo ${included} usuário(s) para o plano destino.`,
            };
        }
        const keepSet = new Set(keep);
        const hasAdmin = active.some(
            (m) => keepSet.has(m.user_id) && ADMIN_ROLES.has(String(m.role).toLowerCase())
        );
        if (active.length > 0 && !hasAdmin) {
            return {
                ok: false,
                error: "A seleção deve incluir pelo menos 1 admin ou owner.",
            };
        }
        return { ok: true, keep_user_ids: keep };
    }

    const requested = opts.keepUserIds ?? [];
    if (requested.length === 0) {
        return {
            ok: false,
            error: `Selecione até ${included} usuário(s) para manter (há ${active.length} ativos).`,
        };
    }
    if (requested.length > included) {
        return {
            ok: false,
            error: `Selecione no máximo ${included} usuário(s) para o plano destino.`,
        };
    }
    for (const id of requested) {
        if (!activeIds.has(id)) {
            return { ok: false, error: "Seleção inválida: usuário inativo ou de outra empresa." };
        }
    }
    const keepSet = new Set(requested);
    const hasAdmin = active.some(
        (m) => keepSet.has(m.user_id) && ADMIN_ROLES.has(String(m.role).toLowerCase())
    );
    if (!hasAdmin) {
        return {
            ok: false,
            error: "A seleção deve incluir pelo menos 1 admin ou owner.",
        };
    }
    return { ok: true, keep_user_ids: requested };
}
