import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPrintAgentMachineApi } from "../../lib/security/printAgentMachineApi";

describe("isPrintAgentMachineApi (S7)", () => {
    it("libera máquina / pairing / jobs", () => {
        for (const path of [
            "/api/agent/activate",
            "/api/agent/activate/foo",
            "/api/agent/auth",
            "/api/agent/heartbeat",
            "/api/agent/print-data",
            "/api/agent/reprint",
            "/api/agent/jobs/poll",
            "/api/agent/jobs/reserve",
            "/api/agent/jobs/complete",
            "/api/agent/jobs/fail",
        ]) {
            assert.equal(isPrintAgentMachineApi(path), true, path);
        }
    });

    it("não libera keys/settings (sessão no proxy)", () => {
        assert.equal(isPrintAgentMachineApi("/api/agent/keys"), false);
        assert.equal(isPrintAgentMachineApi("/api/agent/settings"), false);
        assert.equal(isPrintAgentMachineApi("/api/agent/"), false);
        assert.equal(isPrintAgentMachineApi("/api/agent"), false);
    });
});
