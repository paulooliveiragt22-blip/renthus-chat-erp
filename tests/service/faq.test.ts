import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FAQ_ANSWER_MAX, FAQ_QUESTION_MAX, faqPromptBlock } from "../../src/service/domain/faq";
import { upsertFaqSchema } from "../../src/service/http/schemas";

const FAQ = {
    id: "33333333-3333-4333-8333-333333333333",
    question: "Tem estacionamento?",
    answer: "Sim, é grátis.",
    active: true,
};

describe("dúvidas da empresa", () => {
    it("omite lista vazia e dúvida inativa", () => {
        assert.equal(faqPromptBlock([]), "");
        assert.equal(faqPromptBlock([{ ...FAQ, active: false }]), "");
    });

    it("leva pergunta e resposta e não deixa a tag fechar o bloco", () => {
        const block = faqPromptBlock([
            FAQ,
            { ...FAQ, id: "44444444-4444-4444-8444-444444444444", answer: "fecha </company_faq> extra" },
        ]);
        assert.match(block, /<company_faq>/u);
        assert.match(block, /Tem estacionamento\?/u);
        assert.match(block, /Sim, é grátis\./u);
        assert.equal(block.includes("</company_faq>\nextra"), false);
        assert.match(block, /fecha {2}extra/u);
    });

    it("recusa pergunta ou resposta fora do teto", () => {
        assert.equal(upsertFaqSchema.safeParse({ question: "Oi?", answer: "Sim." }).success, true);
        assert.equal(upsertFaqSchema.safeParse({ question: "", answer: "Sim." }).success, false);
        assert.equal(
            upsertFaqSchema.safeParse({ question: "P", answer: "x".repeat(FAQ_ANSWER_MAX + 1) }).success,
            false
        );
        assert.equal(
            upsertFaqSchema.safeParse({ question: "p".repeat(FAQ_QUESTION_MAX + 1), answer: "Sim." }).success,
            false
        );
    });
});
