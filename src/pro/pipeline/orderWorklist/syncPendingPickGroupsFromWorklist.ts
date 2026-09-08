/**
 * Projection: lines `ambiguous` ↔ PendingPickGroup[] (ADR 0011 D2 / D8).
 */
import { listLinesByStatus } from "@/src/pro/domain/orderWorklist/orderWorklist";
import type { OrderWorklist, PendingPickGroup } from "@/src/types/contracts";
import { isPendingPickGroupClarifyEligible } from "@/src/pro/pipeline/pendingPickGroups";

/** Cap no estado (sessão). Outbound usa `activeClarifyPickGroups` (1). */
export const MAX_STORED_PICK_GROUPS = 3;

/**
 * Groups alinhados a lines `ambiguous` e elegíveis a clarify
 * (≥2 options, ou ≥1 com `unavailableRequestedSigla` — mismatch CX pedida / só UN).
 */
export function pendingPickGroupsAlignedWithWorklist(
    worklist: OrderWorklist | null | undefined,
    groups: readonly PendingPickGroup[]
): PendingPickGroup[] {
    const lines = worklist?.lines ?? [];
    /** Legado / testes sem worklist. */
    if (lines.length === 0) {
        return dedupePickGroupsByLineId([...groups])
            .filter(isPendingPickGroupClarifyEligible)
            .slice(0, MAX_STORED_PICK_GROUPS);
    }
    const ambiguous = listLinesByStatus(worklist, "ambiguous");
    if (!ambiguous.length) return [];
    const synced = syncPendingPickGroupsFromWorklist({ worklist, groups });
    return synced.filter(isPendingPickGroupClarifyEligible).slice(0, MAX_STORED_PICK_GROUPS);
}

/**
 * ADR 0011 D8 — um grupo por mensagem WhatsApp (ordem da worklist).
 * Estado pode ter N ambiguous; UI pergunta só o primeiro.
 */
export function activeClarifyPickGroups(
    worklist: OrderWorklist | null | undefined,
    groups: readonly PendingPickGroup[]
): PendingPickGroup[] {
    const aligned = pendingPickGroupsAlignedWithWorklist(worklist, groups);
    return aligned.slice(0, 1);
}

/**
 * Após resolve do group ativo: junta `remaining` do ativo + irmãos não tocados,
 * depois sync/dedupe (ADR 0011 D8 — não apagar ambiguous laterais).
 */
export function groupsAfterActiveResolve(params: {
    worklist: OrderWorklist | null | undefined;
    allGroups: readonly PendingPickGroup[];
    activeGroups: readonly PendingPickGroup[];
    remaining: readonly PendingPickGroup[];
}): PendingPickGroup[] {
    const activeIds = new Set(
        params.activeGroups.map((g) => String(g.lineId ?? "").trim()).filter(Boolean)
    );
    const siblings = params.allGroups.filter((g) => {
        const id = String(g.lineId ?? "").trim();
        return id ? !activeIds.has(id) : true;
    });
    const merged = dedupePickGroupsByLineId([...params.remaining, ...siblings]);
    return syncPendingPickGroupsFromWorklist({
        worklist: params.worklist,
        groups: merged,
    });
}

export function syncPendingPickGroupsFromWorklist(params: {
    worklist: OrderWorklist | null | undefined;
    groups: readonly PendingPickGroup[];
}): PendingPickGroup[] {
    const lines = params.worklist?.lines ?? [];
    /**
     * Sem worklist (legado / testes): não apagar groups.
     * Com worklist: só groups das lines `ambiguous` (canônico ADR 0011).
     */
    if (lines.length === 0) {
        return dedupePickGroupsByLineId([...params.groups]).slice(0, MAX_STORED_PICK_GROUPS);
    }
    const ambiguous = lines.filter((l) => l.status === "ambiguous");
    const byLineId = new Map(params.groups.map((g) => [g.lineId, g] as const));
    const byKey = new Map(params.groups.map((g) => [g.productKey, g] as const));

    const out: PendingPickGroup[] = [];
    const seenLine = new Set<string>();
    for (const line of ambiguous) {
        if (seenLine.has(line.id)) continue;
        seenLine.add(line.id);
        const key = line.pendingPickGroupKey ?? line.productKey ?? "";
        const existing =
            (line.id ? byLineId.get(line.id) : undefined) ??
            (key ? byKey.get(key) : undefined);
        if (!existing) continue;
        out.push({
            ...existing,
            lineId: line.id,
            productKey: existing.productKey || key,
            requestedQuantity:
                line.quantity != null && line.quantity >= 1
                    ? line.quantity
                    : existing.requestedQuantity ?? null,
        });
        if (out.length >= MAX_STORED_PICK_GROUPS) break;
    }
    return out;
}

/** Preferir group com mais options quando a mesma lineId aparece duas vezes. */
function dedupePickGroupsByLineId(groups: PendingPickGroup[]): PendingPickGroup[] {
    const byLine = new Map<string, PendingPickGroup>();
    for (const g of groups) {
        const id = String(g.lineId ?? "").trim();
        if (!id) continue;
        const prev = byLine.get(id);
        if (!prev || (g.options?.length ?? 0) >= (prev.options?.length ?? 0)) {
            byLine.set(id, g);
        }
    }
    return [...byLine.values()];
}

/** Anexa/atualiza group após search ambíguo, amarrando lineId (dedupe). */
export function upsertPendingPickGroupForLine(params: {
    groups: readonly PendingPickGroup[];
    group: PendingPickGroup;
}): PendingPickGroup[] {
    const g = params.group;
    if (!g.lineId) {
        throw new Error("PendingPickGroup.lineId is required (ADR 0011)");
    }
    const without = params.groups.filter(
        (x) => x.lineId !== g.lineId && x.productKey !== g.productKey
    );
    return dedupePickGroupsByLineId([...without, g]).slice(-MAX_STORED_PICK_GROUPS);
}
