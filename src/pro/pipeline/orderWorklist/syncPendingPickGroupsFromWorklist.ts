/**
 * Projection: lines `ambiguous` ↔ PendingPickGroup[] (ADR 0011 D2).
 */
import type { OrderWorklist, PendingPickGroup } from "@/src/types/contracts";

const MAX_GROUPS = 3;

export function syncPendingPickGroupsFromWorklist(params: {
    worklist: OrderWorklist | null | undefined;
    groups: readonly PendingPickGroup[];
}): PendingPickGroup[] {
    const ambiguous = (params.worklist?.lines ?? []).filter((l) => l.status === "ambiguous");
    const byLineId = new Map(params.groups.map((g) => [g.lineId, g] as const));
    const byKey = new Map(params.groups.map((g) => [g.productKey, g] as const));

    const out: PendingPickGroup[] = [];
    for (const line of ambiguous) {
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
        if (out.length >= MAX_GROUPS) break;
    }
    return out;
}

/** Anexa/atualiza group após search ambíguo, amarrando lineId. */
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
    return [...without, g].slice(-MAX_GROUPS);
}
