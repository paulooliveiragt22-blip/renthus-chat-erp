/**
 * tests/chatbot/intentRegex.test.ts
 *
 * Testes de precisão para as Regex de intenção do chatbot.
 * Valida verdadeiros positivos, verdadeiros negativos e frases "borda"
 * que poderiam causar falsos positivos ou falsos negativos.
 *
 * Executar: npm test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

// ─── Regex copiadas dos módulos (para isolar do runtime) ──────────────────────
// Fonte: lib/chatbot/processMessage.ts

const GREETING_ONLY_RE    = /^(bom\s+dia|boa\s+tarde|boa\s+noite|tudo\s+bem|tudo\s+bom|como\s+vai|como\s+voce|feliz\s+ano|feliz\s+natal|obrigad[oa]|obg|valeu|vlw|tchau|ate\s+mais)\s{0,40}[!?.,]?\s{0,40}$/iu;
const ORDER_STATUS_RE     = /(?:(?<!\w)cad[eê](?!\w)|onde\s+est[aá]\b|onde\s+ficou\b|\bstatus\s+d[oe]\s+pedido\b|\bmeu\s+pedido\b|\bacompanhar\s+pedido\b|\bquanto\s+tempo\s+(?:falta|vai|leva)\b|\bprevis[aã]o\s+de\s+entrega\b)/iu;
const CANCELAR_TEST_RE    = /\b(cancelar|cancela)\b/iu;
const AWAIT_CANCEL_YES_RE = /(?<![a-záàâãéèêíïóôõúüç])\b(sim|yes|pode|confirm|cancela|cancelo)\b(?![a-záàâãéèêíïóôõúüç])/iu;
const AWAIT_CANCEL_NO_RE  = /(?<![a-záàâãéèêíïóôõúüç])\b(nao|não|no|nope|voltar|continuar|nao\s+quero)\b(?![a-záàâãéèêíïóôõúüç])/iu;
const AFFIRMATIVE_RE      = /\b(sim|yes|continuar|continue|blz|ok|pode|beleza|top|certo|perfeito|exato|claro|positivo|vai|bora|isso|manda|confirmar)\b/iu;

// ─── Novos guards de arbitragem (Features 2, 3, 4) ───────────────────────────
// Fonte: lib/chatbot/processMessage.ts

/** Feature 3: negação antes de "cancelar" invalida a intenção */
const NEGATION_CANCEL_RE = /\b(nao|não|nem|nunca|jamais)\b.{0,25}\b(cancelar|cancela)\b/iu;

/** Feature 3: negação genérica que invalida AFFIRMATIVE_RE em intenções críticas */
const NEGATION_RE        = /\b(nao|não|nem|nunca|jamais|de\s+jeito\s+nenhum)\b/iu;

// ─── Helpers de arbitragem (simulam a lógica do processMessage) ──────────────

/**
 * Simula a decisão do step 5: o input é realmente intenção de cancelar?
 * Feature 3: se NEGATION_CANCEL_RE bate, não é.
 */
function isCancelIntent(input: string): boolean {
    return CANCELAR_TEST_RE.test(input) && !NEGATION_CANCEL_RE.test(input);
}

/**
 * Simula a decisão do step 7 para checkout_confirm.
 * Retorna:
 *   "confirm"     → alta confiança, confirmar pedido direto
 *   "clarify"     → baixa confiança (frase longa), pedir confirmação explícita
 *   "passthrough" → negação presente, deixar o switch handler tratar
 */
function affirmativeConfidence(input: string): "confirm" | "clarify" | "passthrough" {
    if (!AFFIRMATIVE_RE.test(input)) return "passthrough";
    if (NEGATION_RE.test(input))     return "passthrough";
    const wordCount = input.trim().split(/\s+/u).length;
    return wordCount <= 4 ? "confirm" : "clarify";
}

// Fonte: lib/chatbot/textParsers.ts
const REMOVE_INTENT_RE = /\b(retira|retire|remove|remova|tira|tire|diminui|diminuir|deleta|exclui|excluir|menos|retirar|tirar)\b/iu;
const PAY_1_RE         = /^\s{0,12}1\s{0,12}$/u;
const PAY_2_RE         = /^\s{0,12}2\s{0,12}$/u;
const PAY_3_RE         = /^\s{0,12}3\s{0,12}$/u;
const PIX_RE           = /\bpix\b/iu;
const CARD_RE          = /\b(cartao|cartão|card|credito|crédito|debito|débito|maquina|maquininha)\b/iu;
const CASH_RE          = /\b(dinheiro|cash|especie|espécie)\b/iu;
const GREET_STRIP_RE   = /^(bom\s+dia|boa\s+tarde|boa\s+noite|oi+|ol[aá]|e\s*a[ií]|ei+|hey|hello|opa)[,!\s]{1,80}/iu;

// Fonte: lib/chatbot/handlers/handleCatalog.ts
const MAIS_PRODUTOS_RE = /\bmais\s+produtos\b/iu;
const VER_CARRINHO_RE  = /\bver\s+carrinho\b/iu;
const CARRINHO_RE      = /\bcarrinho\b/iu;
const FINALIZAR_RE     = /\bfinalizar\b/iu;

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Testa regex sem risco de lastIndex residual (para regex com /g eventual) */
function test(re: RegExp, input: string): boolean {
    const clone = new RegExp(re.source, re.flags.replaceAll("g", ""));
    return clone.test(input);
}

// ─── GREETING_ONLY_RE ────────────────────────────────────────────────────────

describe("GREETING_ONLY_RE — apenas saudação pura, sem produto", () => {
    const positives = [
        "bom dia",
        "Boa Tarde!",
        "boa noite.",
        "tudo bem?",
        "tudo bom",
        "obrigado",
        "obrigada",
        "valeu",
        "vlw",
        "tchau",
        "ate mais",
    ];

    for (const phrase of positives) {
        it(`captura: "${phrase}"`, () => {
            assert.ok(test(GREETING_ONLY_RE, phrase), `esperava match em "${phrase}"`);
        });
    }

    const negatives = [
        "bom dia, quero uma skol",
        "boa tarde quero pedir",
        "oi tudo bem",           // "oi" não está em GREETING_ONLY_RE
        "bom dia! me manda 2 brahma",
        "valeu, quero mais uma",
        "skol lata",
        "1 heineken",
        "cadê meu pedido",
        "quero cancelar",
    ];

    for (const phrase of negatives) {
        it(`NÃO captura: "${phrase}"`, () => {
            assert.ok(!test(GREETING_ONLY_RE, phrase), `esperava sem match em "${phrase}"`);
        });
    }
});

// ─── AFFIRMATIVE_RE ──────────────────────────────────────────────────────────

describe("AFFIRMATIVE_RE — confirmação genérica de intenção", () => {
    const positives = [
        "sim", "ok", "pode", "beleza", "top", "claro",
        "confirmar", "bora", "isso mesmo", "vai sim",
        "pode mandar", "blz", "perfeito", "exato", "positivo", "continuar",
    ];

    for (const phrase of positives) {
        it(`captura: "${phrase}"`, () => {
            assert.ok(test(AFFIRMATIVE_RE, phrase), `esperava match em "${phrase}"`);
        });
    }

    const negatives = [
        "não", "nao", "nunca", "talvez", "não sei",
        "quero cancelar", "skol lata", "cadê meu pedido", "brahma 600",
    ];

    for (const phrase of negatives) {
        it(`NÃO captura: "${phrase}"`, () => {
            assert.ok(!test(AFFIRMATIVE_RE, phrase), `esperava sem match em "${phrase}"`);
        });
    }

    it(`borda: "salve" NÃO captura`, () => {
        assert.ok(!test(AFFIRMATIVE_RE, "salve"));
    });

    it(`borda: "só skol" NÃO captura ("s" sozinho foi removido da regex — "só" não é confirmação)`, () => {
        assert.ok(!test(AFFIRMATIVE_RE, "só skol"));
    });

    it(`borda: "s" sozinho NÃO captura (removido da AFFIRMATIVE_RE para evitar falsos positivos)`, () => {
        assert.ok(!test(AFFIRMATIVE_RE, "s"));
    });

    it(`borda: "pode não" CAPTURA por "pode" — falso positivo documentado (contexto resolve)`, () => {
        assert.ok(test(AFFIRMATIVE_RE, "pode não"));
    });
});

// ─── AWAIT_CANCEL_YES_RE ─────────────────────────────────────────────────────

describe("AWAIT_CANCEL_YES_RE — confirmação de cancelamento", () => {
    const positives = ["sim", "pode", "yes", "cancela", "cancelo", "confirm"];

    for (const phrase of positives) {
        it(`captura: "${phrase}"`, () => {
            assert.ok(test(AWAIT_CANCEL_YES_RE, phrase));
        });
    }

    const negatives = ["não", "nao quero cancelar", "voltar", "skol lata", "2 brahma"];

    for (const phrase of negatives) {
        it(`NÃO captura: "${phrase}"`, () => {
            assert.ok(!test(AWAIT_CANCEL_YES_RE, phrase));
        });
    }

    it(`borda: "s" isolado NÃO captura (removido para evitar falso positivo em "só", "se", etc.)`, () => {
        assert.ok(!test(AWAIT_CANCEL_YES_RE, "s"));
    });
});

// ─── AWAIT_CANCEL_NO_RE ──────────────────────────────────────────────────────

describe("AWAIT_CANCEL_NO_RE — negação do cancelamento", () => {
    const positives = ["nao", "não", "no", "nope", "voltar", "continuar", "nao quero"];

    for (const phrase of positives) {
        it(`captura: "${phrase}"`, () => {
            assert.ok(test(AWAIT_CANCEL_NO_RE, phrase));
        });
    }

    const negatives = ["sim", "pode cancelar", "skol", "2 heineken"];

    for (const phrase of negatives) {
        it(`NÃO captura: "${phrase}"`, () => {
            assert.ok(!test(AWAIT_CANCEL_NO_RE, phrase));
        });
    }

    it(`borda: "n" isolado NÃO captura (removido — "n" aparece em muitos contextos inocentes)`, () => {
        assert.ok(!test(AWAIT_CANCEL_NO_RE, "n"));
    });

    it(`borda: "no pix" captura "no" — falso positivo OK pois a regex só é usada no step awaiting_cancel_confirm`, () => {
        assert.ok(test(AWAIT_CANCEL_NO_RE, "no pix"));
    });
});

// ─── CANCELAR_TEST_RE ────────────────────────────────────────────────────────

describe("CANCELAR_TEST_RE — intenção de cancelar pedido", () => {
    const positives = ["quero cancelar", "cancela o pedido", "cancela tudo", "cancelar"];

    for (const phrase of positives) {
        it(`captura: "${phrase}"`, () => {
            assert.ok(test(CANCELAR_TEST_RE, phrase));
        });
    }

    const negatives = ["confirmar", "ok pode mandar", "finalizar", "sim", "quero skol"];

    for (const phrase of negatives) {
        it(`NÃO captura: "${phrase}"`, () => {
            assert.ok(!test(CANCELAR_TEST_RE, phrase));
        });
    }
});

// ─── REMOVE_INTENT_RE ────────────────────────────────────────────────────────

describe("REMOVE_INTENT_RE — remoção de item do carrinho", () => {
    const positives = [
        "retira a skol", "tire a brahma", "remove o gelo",
        "excluir a heineken", "diminui 1 skol", "menos 2 brahma",
        "tirar o carvão", "deleta isso",
    ];

    for (const phrase of positives) {
        it(`captura: "${phrase}"`, () => {
            assert.ok(test(REMOVE_INTENT_RE, phrase));
        });
    }

    const negatives = ["adicionar skol", "quero mais brahma", "finalizar pedido", "confirmar"];

    for (const phrase of negatives) {
        it(`NÃO captura: "${phrase}"`, () => {
            assert.ok(!test(REMOVE_INTENT_RE, phrase));
        });
    }

    it(`borda: "tira gostoso" captura "tira" — falso positivo aceitável (melhor errar por excesso na remoção)`, () => {
        assert.ok(test(REMOVE_INTENT_RE, "tira gostoso"));
    });
});

// ─── ORDER_STATUS_RE ─────────────────────────────────────────────────────────

describe("ORDER_STATUS_RE — consulta de status do pedido", () => {
    const positives = [
        "cadê meu pedido", "cadê o pedido", "cadê", "onde está meu pedido",
        "onde ficou meu pedido", "status do pedido", "status de pedido",
        "meu pedido", "acompanhar pedido",
        "quanto tempo falta", "quanto tempo vai", "quanto tempo leva",
        "previsão de entrega", "previsao de entrega",
    ];

    for (const phrase of positives) {
        it(`captura: "${phrase}"`, () => {
            assert.ok(test(ORDER_STATUS_RE, phrase));
        });
    }

    const negatives = ["skol lata", "finalizar", "confirmar", "bom dia"];

    for (const phrase of negatives) {
        it(`NÃO captura: "${phrase}"`, () => {
            assert.ok(!test(ORDER_STATUS_RE, phrase));
        });
    }

    it(`borda: "quero fazer um pedido" NÃO captura (usuário quer FAZER pedido, não ver status)`, () => {
        assert.ok(!test(ORDER_STATUS_RE, "quero fazer um pedido"));
    });
});

// ─── Pagamento: número isolado ────────────────────────────────────────────────

describe("PAY_1/2/3_RE — número isolado como opção de pagamento", () => {
    it(`"1" → cartão`,    () => assert.ok(test(PAY_1_RE, "1")));
    it(`"2" → pix`,       () => assert.ok(test(PAY_2_RE, "2")));
    it(`"3" → dinheiro`,  () => assert.ok(test(PAY_3_RE, "3")));
    it(`"  1  " → cartão (espaços aceitos)`, () => assert.ok(test(PAY_1_RE, "  1  ")));

    it(`borda: "1 skol" NÃO é opção de pagamento`, () => assert.ok(!test(PAY_1_RE, "1 skol")));
    it(`borda: "2 brahma" NÃO é opção de pagamento`, () => assert.ok(!test(PAY_2_RE, "2 brahma")));
    it(`borda: "10" NÃO é opção 1 de pagamento`, () => assert.ok(!test(PAY_1_RE, "10")));
    it(`borda: "21" NÃO é opção 2 de pagamento`, () => assert.ok(!test(PAY_2_RE, "21")));
});

// ─── Pagamento: texto livre ───────────────────────────────────────────────────

describe("PIX_RE / CARD_RE / CASH_RE — texto livre", () => {
    const pixCases  = ["pix", "no pix", "vou pagar no pix", "PIX", "Pix"];
    const cardCases = ["cartao", "cartão", "credito", "maquininha", "card", "débito", "maquina"];
    const cashCases = ["dinheiro", "cash", "especie", "espécie"];

    for (const p of pixCases)  it(`PIX_RE captura: "${p}"`,  () => assert.ok(test(PIX_RE, p)));
    for (const p of cardCases) it(`CARD_RE captura: "${p}"`, () => assert.ok(test(CARD_RE, p)));
    for (const p of cashCases) it(`CASH_RE captura: "${p}"`, () => assert.ok(test(CASH_RE, p)));

    it(`borda: "pixar" NÃO captura (\\b garante boundary)`, () => assert.ok(!test(PIX_RE, "pixar")));
    it(`borda: "carro" NÃO captura (\\b garante boundary)`, () => assert.ok(!test(CARD_RE, "carro")));
    it(`borda: "sem dinheiro" captura "dinheiro" — OK, contexto é pagamento`, () => assert.ok(test(CASH_RE, "sem dinheiro")));
});

// ─── Catálogo ─────────────────────────────────────────────────────────────────

describe("Catálogo — MAIS_PRODUTOS / VER_CARRINHO / FINALIZAR / CARRINHO", () => {
    it(`MAIS_PRODUTOS_RE captura "quero ver mais produtos"`, () => {
        assert.ok(test(MAIS_PRODUTOS_RE, "quero ver mais produtos"));
    });
    it(`VER_CARRINHO_RE captura "ver carrinho"`, () => {
        assert.ok(test(VER_CARRINHO_RE, "ver carrinho"));
    });
    it(`CARRINHO_RE captura "meu carrinho"`, () => {
        assert.ok(test(CARRINHO_RE, "meu carrinho"));
    });
    it(`FINALIZAR_RE captura "finalizar pedido"`, () => {
        assert.ok(test(FINALIZAR_RE, "finalizar pedido"));
    });
    it(`borda: MAIS_PRODUTOS_RE NÃO captura "mais skol" (exige a palavra "produtos")`, () => {
        assert.ok(!test(MAIS_PRODUTOS_RE, "mais skol"));
    });
    it(`borda: VER_CARRINHO_RE NÃO captura "carrinho" isolado`, () => {
        assert.ok(!test(VER_CARRINHO_RE, "carrinho"));
    });
    it(`borda: CARRINHO_RE captura "carrinho" isolado (mais ampla, correto)`, () => {
        assert.ok(test(CARRINHO_RE, "carrinho"));
    });
});

// ─── ⚠️  SOBREPOSIÇÕES DOCUMENTADAS ──────────────────────────────────────────

describe("⚠️  Sobreposições entre Regex — comportamento documentado", () => {

    it(`OVERLAP 1: AFFIRMATIVE_RE e AWAIT_CANCEL_YES_RE compartilham "sim" e "pode"`, () => {
        for (const phrase of ["sim", "pode"]) {
            assert.ok(test(AFFIRMATIVE_RE, phrase),       `AFFIRMATIVE_RE deve bater em "${phrase}"`);
            assert.ok(test(AWAIT_CANCEL_YES_RE, phrase),  `AWAIT_CANCEL_YES_RE deve bater em "${phrase}"`);
        }
        // "s" foi removido de ambas as regex — falso positivo em "só", "se", etc.
        // Resolução: step do contexto decide qual regex é avaliada.
    });

    it(`OVERLAP 2: CANCELAR_TEST_RE e AWAIT_CANCEL_YES_RE compartilham "cancela"`, () => {
        assert.ok(test(CANCELAR_TEST_RE, "cancela"));
        assert.ok(test(AWAIT_CANCEL_YES_RE, "cancela"));
        // Resolução: AWAIT_CANCEL_YES_RE só é usada no step "awaiting_cancel_confirm",
        // onde "cancela" confirma o cancelamento — comportamento correto.
    });

    it(`OVERLAP 3: AWAIT_CANCEL_NO_RE e AFFIRMATIVE_RE compartilham "continuar"`, () => {
        assert.ok(test(AWAIT_CANCEL_NO_RE, "continuar"));
        assert.ok(test(AFFIRMATIVE_RE, "continuar"));
        // Resolução: no step awaiting_cancel_confirm, AWAIT_CANCEL_NO_RE tem precedência.
    });

    it(`OVERLAP 4: GREETING_ONLY_RE e GREET_STRIP_RE compartilham "bom dia", "boa tarde", "boa noite"`, () => {
        for (const phrase of ["bom dia", "boa tarde", "boa noite"]) {
            assert.ok(test(GREETING_ONLY_RE, phrase),              `GREETING_ONLY_RE deve bater em "${phrase}"`);
            assert.ok(test(GREET_STRIP_RE, phrase + " skol"),      `GREET_STRIP_RE deve bater em "${phrase} skol"`);
        }
        // Distinção clara:
        //   GREETING_ONLY_RE → mensagem É APENAS saudação (^ ... $) → responde com menu
        //   GREET_STRIP_RE   → saudação NO INÍCIO seguida de conteúdo → remove saudação e processa o resto
    });

    it(`CORRIGIDO: "s" sozinho NÃO captura mais em AFFIRMATIVE_RE e AWAIT_CANCEL_YES_RE`, () => {
        // \bs\b batia em "só", "se", etc. — "ó"/"e" são \W no ASCII, criando boundary falso.
        // Solução: "s" removido das duas regex.
        assert.ok(!test(AFFIRMATIVE_RE, "s"));
        assert.ok(!test(AWAIT_CANCEL_YES_RE, "s"));
    });

    it(`CORRIGIDO: "n" sozinho NÃO captura mais em AWAIT_CANCEL_NO_RE`, () => {
        // Removido para evitar falsos positivos em substrings e abreviações.
        assert.ok(!test(AWAIT_CANCEL_NO_RE, "n"));
    });

    it(`RISCO: "no pix" capturado como negação por AWAIT_CANCEL_NO_RE ("no")`, () => {
        assert.ok(test(AWAIT_CANCEL_NO_RE, "no pix"));
        // Mitigação: no step awaiting_cancel_confirm o cliente não está escolhendo pagamento.
        // Se o step mudar, atenção a essa ambiguidade.
    });
});

// ─── Feature 3 — NEGATION_CANCEL_RE ──────────────────────────────────────────

describe("NEGATION_CANCEL_RE — filtro de negação antes de cancelar", () => {
    const shouldNegate = [
        "não quero cancelar",
        "nao quero cancelar",
        "nem cancelar",
        "nunca cancelar",
        "jamais cancelar",
        "não, cancelar não",
        "nao precisa cancelar",
    ];

    for (const phrase of shouldNegate) {
        it(`bloqueia cancel: "${phrase}"`, () => {
            assert.ok(!isCancelIntent(phrase), `esperava NÃO ser cancel em "${phrase}"`);
        });
    }

    const shouldCancel = [
        "cancelar",
        "quero cancelar",
        "cancela o pedido",
        "cancela tudo",
        "pode cancelar",   // "pode" não é negação
    ];

    for (const phrase of shouldCancel) {
        it(`permite cancel: "${phrase}"`, () => {
            assert.ok(isCancelIntent(phrase), `esperava cancel em "${phrase}"`);
        });
    }

    it(`borda: "não gosto, cancelar" — negação longe do cancelar (> 25 chars) → permite cancel`, () => {
        // A janela de 25 chars evita bloquear negações não relacionadas
        const phrase = "não estou gostando muito do atendimento, quero cancelar";
        // "não" está a ~50 chars de "cancelar" → NÃO bloqueia → isCancelIntent = true
        assert.ok(isCancelIntent(phrase));
    });
});

// ─── Feature 3 — NEGATION_RE ─────────────────────────────────────────────────

describe("NEGATION_RE — negação genérica que invalida AFFIRMATIVE_RE", () => {
    const positives = [
        "não", "nao", "nem", "nunca", "jamais", "de jeito nenhum",
        "não, pode não", "nao confirma", "nem pensar",
    ];

    for (const phrase of positives) {
        it(`detecta negação: "${phrase}"`, () => {
            assert.ok(test(NEGATION_RE, phrase));
        });
    }

    const negatives = [
        "sim", "ok", "confirmar", "pode", "bora",
        "quero 2 skol", "finalizar pedido",
    ];

    for (const phrase of negatives) {
        it(`NÃO detecta negação: "${phrase}"`, () => {
            assert.ok(!test(NEGATION_RE, phrase));
        });
    }
});

// ─── Features 2, 3, 4 — affirmativeConfidence ────────────────────────────────

describe("affirmativeConfidence — confiança restrita + fallback de confirmação", () => {

    // Alta confiança: frase curta sem negação → confirma direto
    const highConf: [string, string][] = [
        ["sim",              "confirm"],
        ["ok",               "confirm"],
        ["pode",             "confirm"],
        ["confirmar",        "confirm"],
        ["bora sim",         "confirm"],
        ["vai vai",          "confirm"],
        ["ok pode",          "confirm"],
        ["sim confirmar",    "confirm"],
    ];

    for (const [phrase, expected] of highConf) {
        it(`"${phrase}" → ${expected} (alta confiança, ≤ 4 palavras)`, () => {
            assert.strictEqual(affirmativeConfidence(phrase), expected);
        });
    }

    // Baixa confiança: frase longa sem negação → pede clarificação
    const lowConf: [string, string][] = [
        ["ok mas antes de confirmar, tem troco?",      "clarify"],
        ["pode confirmar sim, endereço está certo",    "clarify"],
        ["bora pode mandar que estou esperando aqui",  "clarify"],
        ["sim quero confirmar mas muda o endereço",    "clarify"],
    ];

    for (const [phrase, expected] of lowConf) {
        it(`"${phrase}" → ${expected} (baixa confiança, > 4 palavras)`, () => {
            assert.strictEqual(affirmativeConfidence(phrase), expected);
        });
    }

    // Negação presente → passthrough (não confirma, não pede clarificação)
    const negated: [string, string][] = [
        ["não, pode não",                      "passthrough"],
        ["nao confirma",                       "passthrough"],
        ["não quero confirmar agora",          "passthrough"],
        ["nem pensar em confirmar",            "passthrough"],
        ["ok mas não quero confirmar ainda",   "passthrough"],
    ];

    for (const [phrase, expected] of negated) {
        it(`"${phrase}" → ${expected} (negação presente)`, () => {
            assert.strictEqual(affirmativeConfidence(phrase), expected);
        });
    }

    // Sem match afirmativo → passthrough
    const noMatch: [string, string][] = [
        ["cadê meu pedido",  "passthrough"],
        ["quero 2 skol",     "passthrough"],
        ["cancelar",         "passthrough"],
        ["",                 "passthrough"],
    ];

    for (const [phrase, expected] of noMatch) {
        it(`"${phrase}" → ${expected} (sem palavra afirmativa)`, () => {
            assert.strictEqual(affirmativeConfidence(phrase), expected);
        });
    }
});
