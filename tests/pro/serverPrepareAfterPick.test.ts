import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProSessionState } from "../../src/types/contracts";
import { resolvePickedEmbalagemId } from "../../src/pro/pipeline/serverPrepareAfterPick";

describe("resolvePickedEmbalagemId", () => {
    it("pega o primeiro id da allowlist (pick)", () => {
        const state = {
            searchProdutoEmbalagemIds: ["picked", "draft-old"],
        } as ProSessionState;
        assert.equal(resolvePickedEmbalagemId(state), "picked");
    });

    it("null quando vazio", () => {
        const state = { searchProdutoEmbalagemIds: [] as string[] } as ProSessionState;
        assert.equal(resolvePickedEmbalagemId(state), null);
    });
});
