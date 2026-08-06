import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchExplicitSiglaFromText } from "../../src/pro/pipeline/siglaMatch";

const diskSiglas = [
    { id: "1", sigla: "UN", descricao: "Unidade" },
    { id: "2", sigla: "CX", descricao: "Caixa" },
    { id: "3", sigla: "FARD", descricao: "Fardo" },
    { id: "4", sigla: "PAC", descricao: "Pacote" },
    { id: "5", sigla: "COMBO", descricao: null },
];

describe("matchExplicitSiglaFromText", () => {
    it("caixa → CX", () => {
        assert.equal(matchExplicitSiglaFromText("uma caixa de skol", diskSiglas), "CX");
    });
    it("unidades → UN", () => {
        assert.equal(matchExplicitSiglaFromText("duas unidades de brahma", diskSiglas), "UN");
    });
    it("combo → COMBO", () => {
        assert.equal(matchExplicitSiglaFromText("quero o combo skol", diskSiglas), "COMBO");
    });
    it("fardo → FARD", () => {
        assert.equal(matchExplicitSiglaFromText("1 fardo de agua", diskSiglas), "FARD");
    });
    it("sem menção → null", () => {
        assert.equal(matchExplicitSiglaFromText("tres brahma 600", diskSiglas), null);
    });
});
