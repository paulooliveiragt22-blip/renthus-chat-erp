import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createInFlightGate } from "../../lib/chatbot/anthropicInFlightGate";

function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
}

describe("createInFlightGate — isolamento por provider (Fase 7 do plano multi-provider)", () => {
    it("respeita o cap: a N+1-ésima chamada só roda depois de uma liberar", async () => {
        process.env.TEST_GATE_CAP_A = "1";
        const gate = createInFlightGate("TEST_GATE_CAP_A", 8);

        let secondStarted = false;
        const first = deferred<void>();

        const p1 = gate(async () => {
            await first.promise;
            return "first";
        });
        // dá um tick pro primeiro pegar o slot antes do segundo tentar
        await new Promise((r) => setTimeout(r, 5));

        const p2 = gate(async () => {
            secondStarted = true;
            return "second";
        });
        await new Promise((r) => setTimeout(r, 5));
        assert.equal(secondStarted, false, "segunda chamada não deveria rodar com cap=1 ocupado");

        first.resolve();
        assert.equal(await p1, "first");
        assert.equal(await p2, "second");
        assert.equal(secondStarted, true);

        delete process.env.TEST_GATE_CAP_A;
    });

    it("dois gates independentes não compartilham contador — saturar um não bloqueia o outro", async () => {
        process.env.TEST_GATE_CAP_B1 = "1";
        process.env.TEST_GATE_CAP_B2 = "1";
        const gateA = createInFlightGate("TEST_GATE_CAP_B1", 8);
        const gateB = createInFlightGate("TEST_GATE_CAP_B2", 8);

        const blockA = deferred<void>();
        // satura o gate A (cap=1) com uma chamada pendente
        const pA1 = gateA(async () => {
            await blockA.promise;
            return "a1";
        });
        await new Promise((r) => setTimeout(r, 5));

        // gate B, mesmo com A saturado, deve rodar imediatamente (contador separado)
        const resultB = await gateB(async () => "b1");
        assert.equal(resultB, "b1");

        blockA.resolve();
        assert.equal(await pA1, "a1");

        delete process.env.TEST_GATE_CAP_B1;
        delete process.env.TEST_GATE_CAP_B2;
    });
});
