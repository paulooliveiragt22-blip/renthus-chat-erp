import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isReversibleJournalLine } from "@/src/financeiro/application/reverseJournal";

describe("reverseJournal helpers", () => {
    it("isReversibleJournalLine ignora caixa e linhas zeradas", () => {
        assert.equal(
            isReversibleJournalLine({
                code: "3.1",
                name: "Receita",
                direction: "credit",
                amount: 100,
                remaining: 50,
                label: "Itens (receita de produtos)",
            }),
            true
        );
        assert.equal(
            isReversibleJournalLine({
                code: "1.1",
                name: "Caixa",
                direction: "debit",
                amount: 100,
                remaining: 100,
                label: "Caixa",
            }),
            false
        );
        assert.equal(
            isReversibleJournalLine({
                code: "3.2",
                name: "Entrega",
                direction: "credit",
                amount: 10,
                remaining: 0,
                label: "Taxa de entrega",
            }),
            false
        );
    });
});
