import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PendingPickGroup } from "../../src/types/contracts";
import {
    buildPendingPickGroup,
    buildPickClarificationFreeText,
    groupsPastSafetyNet,
    productKeyFromQuery,
    productKeyFromRows,
    removePendingPickGroupContaining,
    removePendingPickGroupsByKeys,
    resolvePendingPickGroupsFromFreeText,
    upsertPendingPickGroup,
    PENDING_PICK_SAFETY_NET_TURNS,
} from "../../src/pro/pipeline/pendingPickGroups";

function skolGroup(unresolvedTurns = 0): PendingPickGroup {
    return {
        productKey: "skol lata",
        productLabel: "SKOL LATA",
        unresolvedTurns,
        options: [
            {
                embalagemId: "skol-un",
                displayName: "SKOL LATA",
                productName: "SKOL LATA",
                siglaComercial: "UN",
                precoVenda: 5,
                fatorConversao: 1,
            },
            {
                embalagemId: "skol-cx",
                displayName: "SKOL LATA (CX c/15)",
                productName: "SKOL LATA",
                siglaComercial: "CX",
                precoVenda: 60,
                fatorConversao: 15,
            },
        ],
    };
}

function originalGroup(unresolvedTurns = 0): PendingPickGroup {
    return {
        productKey: "original 600ml",
        productLabel: "ORIGINAL 600ML",
        unresolvedTurns,
        options: [
            {
                embalagemId: "orig-un",
                displayName: "ORIGINAL 600ML",
                productName: "ORIGINAL 600ML",
                siglaComercial: "UN",
                precoVenda: 15,
                fatorConversao: 1,
            },
            {
                embalagemId: "orig-cx",
                displayName: "ORIGINAL 600ML (CX c/24)",
                productName: "ORIGINAL 600ML",
                siglaComercial: "CX",
                precoVenda: 360,
                fatorConversao: 24,
            },
        ],
    };
}

/** Produtos/variantes com NOMES DISTINTOS batendo no mesmo termo (não é a mesma família de embalagem). */
function mixedOriginalGroup(unresolvedTurns = 0): PendingPickGroup {
    return {
        productKey: "original",
        productLabel: "original",
        unresolvedTurns,
        options: [
            {
                embalagemId: "orig-600-un",
                displayName: "ORIGINAL 600ML",
                productName: "Original 600ml",
                siglaComercial: "UN",
                precoVenda: 15,
                fatorConversao: 1,
            },
            {
                embalagemId: "orig-600-cx",
                displayName: "ORIGINAL 600ML (CX c/24)",
                productName: "Original 600ml",
                siglaComercial: "CX",
                precoVenda: 360,
                fatorConversao: 24,
            },
            {
                embalagemId: "orig-lata",
                displayName: "ORIGINAL LATA",
                productName: "Original Lata",
                siglaComercial: "UN",
                precoVenda: 6,
                fatorConversao: 1,
            },
        ],
    };
}

describe("pendingPickGroups: build/upsert/remove", () => {
    it("productKeyFromRows normaliza o nome do produto", () => {
        assert.equal(
            productKeyFromRows([{ product_name: "  Skol Lata  " }]),
            "skol lata"
        );
    });

    it("productKeyFromQuery normaliza o termo de busca (usado quando as linhas têm nomes distintos)", () => {
        assert.equal(productKeyFromQuery("  Original  "), "original");
    });

    it("buildPendingPickGroup limita a 4 opções e mapeia campos", () => {
        const group = buildPendingPickGroup("skol lata", "SKOL LATA", [
            { id: "1", sigla_comercial: "UN", preco_venda: 5, fator_conversao: 1 },
            { id: "2", sigla_comercial: "CX", preco_venda: 60, fator_conversao: 15 },
            { id: "3", sigla_comercial: "FARD", preco_venda: 100, fator_conversao: 24 },
            { id: "4", sigla_comercial: "PAC", preco_venda: 40, fator_conversao: 6 },
            { id: "5", sigla_comercial: "COMBO", preco_venda: 200, fator_conversao: 48 },
        ]);
        assert.equal(group.options.length, 4);
        assert.equal(group.unresolvedTurns, 0);
        assert.equal(group.options[0]!.embalagemId, "1");
    });

    it("upsertPendingPickGroup substitui grupo existente pelo mesmo productKey", () => {
        const groups = upsertPendingPickGroup([skolGroup()], {
            ...skolGroup(),
            productLabel: "SKOL LATA ATUALIZADO",
        });
        assert.equal(groups.length, 1);
        assert.equal(groups[0]!.productLabel, "SKOL LATA ATUALIZADO");
    });

    it("upsertPendingPickGroup limita a 3 grupos (mais recentes)", () => {
        let groups: PendingPickGroup[] = [];
        for (const key of ["a", "b", "c", "d"]) {
            groups = upsertPendingPickGroup(groups, { ...skolGroup(), productKey: key });
        }
        assert.equal(groups.length, 3);
        assert.deepEqual(
            groups.map((g) => g.productKey),
            ["b", "c", "d"]
        );
    });

    it("removePendingPickGroupContaining remove o grupo que tem essa embalagem", () => {
        const groups = removePendingPickGroupContaining(
            [skolGroup(), originalGroup()],
            "skol-cx"
        );
        assert.equal(groups.length, 1);
        assert.equal(groups[0]!.productKey, "original 600ml");
    });

    it("removePendingPickGroupsByKeys remove por productKey", () => {
        const groups = removePendingPickGroupsByKeys(
            [skolGroup(), originalGroup()],
            ["skol lata"]
        );
        assert.equal(groups.length, 1);
        assert.equal(groups[0]!.productKey, "original 600ml");
    });
});

describe("pendingPickGroups: buildPickClarificationFreeText", () => {
    it("gera pergunta consolidada para 1 grupo, sem preço/opções na prosa", () => {
        const text = buildPickClarificationFreeText([skolGroup()]);
        assert.match(text, /SKOL LATA/);
        assert.match(text, /unidade/);
        assert.match(text, /caixa/);
        assert.doesNotMatch(text, /R\$/);
    });

    it("gera pergunta consolidada para 2+ grupos, um por linha", () => {
        const text = buildPickClarificationFreeText([skolGroup(), originalGroup()]);
        assert.match(text, /SKOL LATA/);
        assert.match(text, /ORIGINAL 600ML/);
        assert.equal(text.split("\n").filter((l) => l.startsWith("•")).length, 2);
    });

    it("grupo com nomes DISTINTOS (não mesma família): lista o nome real de cada opção, não sigla genérica duplicada", () => {
        const text = buildPickClarificationFreeText([mixedOriginalGroup()]);
        assert.match(text, /ORIGINAL 600ML \(CX c\/24\)/);
        assert.match(text, /ORIGINAL LATA/);
        // duas opções UN com nomes diferentes não podem colapsar na mesma palavra "unidade"
        const line = text.split("\n").find((l) => l.startsWith("•"))!;
        assert.doesNotMatch(line, /unidade, unidade|unidade,\s*unidade/);
        assert.doesNotMatch(text, /R\$/);
    });
});

describe("pendingPickGroups: resolvePendingPickGroupsFromFreeText", () => {
    it("1 grupo, texto explícito de embalagem: resolve", () => {
        const { resolved, remaining } = resolvePendingPickGroupsFromFreeText(
            [skolGroup()],
            "caixa"
        );
        assert.equal(remaining.length, 0);
        assert.equal(resolved.length, 1);
        assert.equal(resolved[0]!.embalagemId, "skol-cx");
    });

    it("1 grupo, texto ambíguo (quantidade maior que qualquer fator, sem sigla explícita): mantém pendente e incrementa unresolvedTurns", () => {
        const { resolved, remaining } = resolvePendingPickGroupsFromFreeText(
            [skolGroup()],
            "quero 20"
        );
        assert.equal(resolved.length, 0);
        assert.equal(remaining.length, 1);
        assert.equal(remaining[0]!.unresolvedTurns, 1);
    });

    it("2 grupos, resposta com os dois segmentos: resolve ambos (bug do S2)", () => {
        const { resolved, remaining } = resolvePendingPickGroupsFromFreeText(
            [skolGroup(), originalGroup()],
            "1 caixa de skol e 2 latas de original"
        );
        assert.equal(remaining.length, 0, "não deve sobrar nenhum grupo pendente");
        assert.equal(resolved.length, 2);
        const byKey = new Map(resolved.map((r) => [r.productKey, r]));
        assert.equal(byKey.get("skol lata")?.embalagemId, "skol-cx");
        assert.equal(byKey.get("skol lata")?.quantity, 1);
        assert.equal(byKey.get("original 600ml")?.embalagemId, "orig-un");
        assert.equal(byKey.get("original 600ml")?.quantity, 2);
    });

    it("2 grupos, só 1 segmento reconhecível e 1 sobra: resolve por exclusão", () => {
        const { resolved, remaining } = resolvePendingPickGroupsFromFreeText(
            [skolGroup(), originalGroup()],
            "1 caixa de skol e 2 latas"
        );
        assert.equal(remaining.length, 0);
        assert.equal(resolved.length, 2);
        const byKey = new Map(resolved.map((r) => [r.productKey, r]));
        assert.equal(byKey.get("skol lata")?.embalagemId, "skol-cx");
        assert.equal(byKey.get("original 600ml")?.embalagemId, "orig-un");
    });

    it("2 grupos, resposta só sobre 1 produto: o outro fica pendente", () => {
        const { resolved, remaining } = resolvePendingPickGroupsFromFreeText(
            [skolGroup(), originalGroup()],
            "quero caixa de skol"
        );
        assert.equal(resolved.length, 1);
        assert.equal(resolved[0]!.productKey, "skol lata");
        assert.equal(remaining.length, 1);
        assert.equal(remaining[0]!.productKey, "original 600ml");
        assert.equal(remaining[0]!.unresolvedTurns, 1);
    });

    it("grupo com nomes distintos: 'quero a lata' resolve pra ORIGINAL LATA (não confunde com 600ml UN)", () => {
        const { resolved, remaining } = resolvePendingPickGroupsFromFreeText(
            [mixedOriginalGroup()],
            "quero a lata"
        );
        assert.equal(remaining.length, 0);
        assert.equal(resolved.length, 1);
        assert.equal(resolved[0]!.embalagemId, "orig-lata");
    });

    it("grupo com nomes distintos: 'quero uma caixa' resolve pra ORIGINAL 600ML (CX) via sigla explícita", () => {
        const { resolved, remaining } = resolvePendingPickGroupsFromFreeText(
            [mixedOriginalGroup()],
            "quero uma caixa"
        );
        assert.equal(remaining.length, 0);
        assert.equal(resolved.length, 1);
        assert.equal(resolved[0]!.embalagemId, "orig-600-cx");
    });

    it("grupo com nomes distintos: '600ml' sozinho (UN e CX batem) segue genuinamente ambíguo — não adivinha", () => {
        const { resolved, remaining } = resolvePendingPickGroupsFromFreeText(
            [mixedOriginalGroup()],
            "quero 600ml"
        );
        assert.equal(resolved.length, 0);
        assert.equal(remaining.length, 1);
        assert.equal(remaining[0]!.unresolvedTurns, 1);
    });

    it("sem grupos pendentes: no-op", () => {
        const { resolved, remaining } = resolvePendingPickGroupsFromFreeText([], "qualquer coisa");
        assert.equal(resolved.length, 0);
        assert.equal(remaining.length, 0);
    });
});

describe("pendingPickGroups: groupsPastSafetyNet", () => {
    it("filtra só grupos que atingiram o teto de tentativas", () => {
        const groups = [
            skolGroup(PENDING_PICK_SAFETY_NET_TURNS),
            originalGroup(PENDING_PICK_SAFETY_NET_TURNS - 1),
        ];
        const past = groupsPastSafetyNet(groups);
        assert.equal(past.length, 1);
        assert.equal(past[0]!.productKey, "skol lata");
    });
});
