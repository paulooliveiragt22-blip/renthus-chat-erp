import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accountBusinessLabel } from "@/src/financeiro/domain/accountLabels";

describe("accountBusinessLabel", () => {
    it("mapeia contas de receita", () => {
        assert.equal(accountBusinessLabel("3.1"), "Itens (receita de produtos)");
        assert.equal(accountBusinessLabel("3.2"), "Taxa de entrega");
        assert.equal(accountBusinessLabel("3.3"), "Taxas de serviço");
    });
});
