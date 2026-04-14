/**
 * Heurísticas servidor-side alinhadas à spec §2 (contador de “falhas interpretativas”):
 * não contar como falha quando o cliente está fornecendo dado de pedido / endereço / pagamento,
 * ou quando a IA já usou ferramentas e produziu resposta substantiva (evita punir INTENT_UNKNOWN erróneo).
 */

import { normalize } from "../utils";

function norm(s: string): string {
    return normalize(s);
}

/** Respostas típicas de quantidade (1–99). */
function looksLikeQuantityOnly(t: string): boolean {
    return /^\s*\d{1,2}\s*$/.test(t);
}

/** Número de porta / complemento curto. */
function looksLikeHouseNumberFragment(t: string): boolean {
    const n = t.trim();
    return n.length <= 12 && /^\d{1,5}\s*[a-zA-Z]?$/.test(n);
}

/** Cliente enviando endereço, pagamento ou ajuste de pedido — não é “falha de interpretação”. */
export function userLikelySupplyingOrderData(userInput: string): boolean {
    const n = norm(userInput);
    if (n.length < 2 || n.length > 220) return false;

    if (looksLikeQuantityOnly(userInput) || looksLikeHouseNumberFragment(userInput)) return true;

    const dataTokens = [
        "pix",
        "dinheiro",
        "cartao",
        "cartão",
        "troco",
        "sem troco",
        "cartao de credito",
        "cartão de crédito",
        "debito",
        "débito",
        "rua",
        "av.",
        "av ",
        "avenida",
        "travessa",
        "alameda",
        "bairro",
        "cep",
        "casa",
        "apto",
        "ap.",
        "bloco",
        "numero",
        "número",
        "nº",
        "fica na",
        "fico na",
        "moro na",
        "morada",
        "endereco",
        "endereço",
        "entregar",
        "entrega em",
        "de sempre",
        "o de sempre",
        "ultimo pedido",
        "último pedido",
        "igual ao",
        "mesmo endereco",
        "mesmo endereço",
        "tira",
        "remove",
        "retira",
        "cancela essa",
        "troca por",
        "mudar",
        "muda",
        "coloca mais",
        "mais uma",
        "tambem",
        "também",
    ];
    if (dataTokens.some((k) => n.includes(norm(k)))) return true;

    // Linha com vírgulas e dígitos costuma ser endereço por extenso.
    if (userInput.includes(",") && /\d/.test(userInput) && n.length <= 180) return true;

    return false;
}

/**
 * Quando o modelo devolve INTENT_UNKNOWN, deve incrementar o streak de falhas?
 * Retorna false para suprimir o incremento (mantém o valor anterior).
 */
export function shouldIncrementProMisunderstandingStreak(params: {
    userInput:      string;
    toolRoundsUsed: number;
    visibleReply:   string;
}): boolean {
    const { userInput, toolRoundsUsed, visibleReply } = params;

    if (userLikelySupplyingOrderData(userInput)) return false;

    // Resposta longa após uso de tools: provável resposta útil apesar do marcador errado.
    if (toolRoundsUsed > 0 && visibleReply.trim().length >= 28) return false;

    return true;
}
