import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProPipelineTelemetryReason } from "../../src/types/contracts";

/**
 * Garante §6: catálogo de motivos em métricas `pro_pipeline.*` fica explícito e **&lt; 10** valores.
 * Se alguém acrescentar a `ProPipelineTelemetryReason` sem actualizar este mapa, o TypeScript falha a compilação.
 */
describe("ProPipelineTelemetryReason (§6)", () => {
    it("mantém exactamente 9 motivos estáveis para tags.reason", () => {
        const _: Record<ProPipelineTelemetryReason, true> = {
            draft_validation_failed: true,
            finalize_blocked: true,
            confirmation_ambiguous: true,
            tool_output_rejected: true,
            ai_timeout: true,
            ai_rate_limited: true,
            ai_provider_error: true,
            ai_invalid_response: true,
            order_rejected: true,
        };
        assert.equal(Object.keys(_).length, 9);
    });
});
