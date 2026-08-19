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
            }),
            false
        );
    });
});
