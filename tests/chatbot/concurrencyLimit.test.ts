import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runWithConcurrencyLimit } from "../../lib/chatbot/queue/concurrencyLimit";

describe("runWithConcurrencyLimit", () => {
    it("nunca mais que `limit` workers ativos ao mesmo tempo", async () => {
        let active = 0;
        let peak = 0;
        const items = [1, 2, 3, 4, 5];
        await runWithConcurrencyLimit(items, 2, async () => {
            active++;
            peak = Math.max(peak, active);
            await new Promise((r) => setTimeout(r, 20));
            active--;
        });
        assert.equal(peak, 2);
        assert.equal(active, 0);
    });

    it("processa todos os itens", async () => {
        const seen: number[] = [];
        await runWithConcurrencyLimit([10, 20, 30], 2, async (n) => {
            seen.push(n);
        });
        assert.deepEqual(seen.sort((a, b) => a - b), [10, 20, 30]);
    });

    it("erro em um item não aborta os demais; relança o primeiro erro no final", async () => {
        const seen: number[] = [];
        await assert.rejects(
            () =>
                runWithConcurrencyLimit([1, 2, 3], 2, async (n) => {
                    seen.push(n);
                    if (n === 1) throw new Error("boom");
                }),
            /boom/
        );
        assert.deepEqual(seen.sort((a, b) => a - b), [1, 2, 3]);
    });

    it("lista vazia resolve sem chamar o worker", async () => {
        let calls = 0;
        await runWithConcurrencyLimit([], 3, async () => {
            calls++;
        });
        assert.equal(calls, 0);
    });
});
