import type { OrderWorklist, PendingPickGroup } from "@/src/types/contracts";
import { MAX_WORKLIST_LINES } from "./orderWorklist";

export type WorklistInvariantViolation = {
    code: string;
    detail: string;
};

export function collectWorklistInvariantViolations(params: {
    worklist: OrderWorklist | null | undefined;
    pendingPickGroups?: readonly PendingPickGroup[] | null;
}): WorklistInvariantViolation[] {
    const out: WorklistInvariantViolation[] = [];
    const wl = params.worklist;
    if (!wl) return out;

    if (wl.lines.length > MAX_WORKLIST_LINES) {
        out.push({
            code: "max_lines",
            detail: `lines=${wl.lines.length} > ${MAX_WORKLIST_LINES}`,
        });
    }

    const ambiguousKeys = new Map<string, string>();
    for (const line of wl.lines) {
        if (line.status === "ambiguous" && line.productKey) {
            const prev = ambiguousKeys.get(line.productKey);
            if (prev && prev !== line.id) {
                out.push({
                    code: "duplicate_ambiguous_product_key",
                    detail: `productKey=${line.productKey}`,
                });
            }
            ambiguousKeys.set(line.productKey, line.id);
        }
        if (line.status === "in_draft" && !line.produtoEmbalagemId) {
            out.push({
                code: "in_draft_missing_embalagem",
                detail: `lineId=${line.id}`,
            });
        }
    }

    for (const g of params.pendingPickGroups ?? []) {
        if (!g.lineId) {
            out.push({ code: "group_missing_line_id", detail: `productKey=${g.productKey}` });
            continue;
        }
        const line = wl.lines.find((l) => l.id === g.lineId);
        if (!line) {
            out.push({
                code: "group_line_missing",
                detail: `lineId=${g.lineId}`,
            });
            continue;
        }
        if (line.status !== "ambiguous") {
            out.push({
                code: "group_line_not_ambiguous",
                detail: `lineId=${g.lineId} status=${line.status}`,
            });
        }
    }

    return out;
}

export function assertWorklistInvariants(params: {
    worklist: OrderWorklist | null | undefined;
    pendingPickGroups?: readonly PendingPickGroup[] | null;
}): void {
    const violations = collectWorklistInvariantViolations(params);
    if (violations.length > 0) {
        throw new Error(
            `OrderWorklist invariants: ${violations.map((v) => `${v.code}:${v.detail}`).join("; ")}`
        );
    }
}
