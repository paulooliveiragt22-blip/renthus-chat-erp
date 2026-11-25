import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { flagsForPreset } from "../../src/service/domain/preset";

describe("flags do modelo de serviço", () => {
    it("horário liga só a agenda", () => {
        assert.deepEqual(flagsForPreset("horario"), {
            agendaEnabled: true,
            casesEnabled: false,
        });
    });

    it("serviço e consulta e caso ligam agenda e card", () => {
        assert.deepEqual(flagsForPreset("servico"), flagsForPreset("consulta_caso"));
        assert.equal(flagsForPreset("servico").casesEnabled, true);
    });

    it("balcão desliga os dois", () => {
        assert.deepEqual(flagsForPreset("balcao"), {
            agendaEnabled: false,
            casesEnabled: false,
        });
    });
});
