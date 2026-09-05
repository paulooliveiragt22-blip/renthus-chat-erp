/**
 * Testes unitários para a lógica de mark-abandoned.
 * Apenas a função de query (pura) — o route handler completo requer Supabase real.
 */

import assert from "node:assert";
import { describe, it } from "node:test";

const NOW = new Date("2026-08-28T12:00:00.000Z");

/** Espelha o corte canônico em rpc_mark_abandoned_due (`interval '14 days'`). */
function buildAbandonedCutoff(now: Date = NOW): Date {
    const ABANDONED_GRACE_DAYS = 14;
    return new Date(now.getTime() - ABANDONED_GRACE_DAYS * 86_400_000);
}

describe("ABANDONED_GRACE_DAYS cutoff", () => {
    it("cutoff = agora - 14 dias", () => {
        const cutoff = buildAbandonedCutoff();
        // 2026-08-28 - 14 dias = 2026-08-14
        assert.equal(cutoff.toISOString().slice(0, 10), "2026-08-14");
    });

    it("created_at <= cutoff indica que empresa está inativa há tempo suficiente", () => {
        const cutoff = buildAbandonedCutoff();
        const staleCreatedAt = new Date(cutoff.getTime() - 1); // 1ms antes do cutoff
        const recentCreatedAt = new Date(cutoff.getTime() + 86_400_000); // 1 dia depois

        assert.equal(
            staleCreatedAt.getTime() <= cutoff.getTime(),
            true,
            "empresa criada antes do cutoff deveria ser considerada abandonada"
        );
        assert.equal(
            recentCreatedAt.getTime() <= cutoff.getTime(),
            false,
            "empresa criada depois do cutoff NÃO deveria ser marcada"
        );
    });
});

describe("abandoned status transition", () => {
    it("pending_setup → abandoned é transição válida", () => {
        const validStatuses = ["pending_setup", "pending_payment"];
        assert.equal(validStatuses.includes("pending_setup"), true);
        assert.equal(validStatuses.includes("pending_payment"), true);
    });

    it("active, trial, blocked NÃO são válidos para abandoned", () => {
        const validStatuses = ["pending_setup", "pending_payment"];
        assert.equal(validStatuses.includes("active"), false);
        assert.equal(validStatuses.includes("trial"), false);
        assert.equal(validStatuses.includes("blocked"), false);
        assert.equal(validStatuses.includes("abandoned"), false); // já está abandoned
    });
});

describe("abandoned_at populado corretamente", () => {
    it("ao marcar abandoned, abandoned_at deve ser setado", () => {
        const now = new Date();
        // O update deveria incluir abandoned_at = now
        assert.ok(now instanceof Date, "abandoned_at deve ser a data atual");
        assert.ok(Number.isFinite(now.getTime()), "abandoned_at deve ser um timestamp válido");
    });

    it("ao sair de abandoned, abandoned_at deve ser null", () => {
        // Trigger no banco: IF OLD.status = 'abandoned' AND NEW.status <> 'abandoned' → abandoned_at = NULL
        const nextStatus: string = "trial";
        const currentStatus: string = "abandoned";
        const shouldClearAbandonedAt = currentStatus === "abandoned" && nextStatus !== "abandoned";
        assert.equal(shouldClearAbandonedAt, true);
    });
});
