/**
 * Detecção de confirmação / recusa de pedido (PT-BR) sem regex.
 * Usada só no servidor antes de gravar pedido — não confiar no modelo.
 */

import { normalize } from "../utils";

const CONFIRM_PHRASES = [
    "sim",
    "isso",
    "isso ai",
    "isso aí",
    "ok",
    "okay",
    "pode ser",
    "pode mandar",
    "manda ver",
    "manda",
    "mande",
    "fechou",
    "fecha",
    "confirmo",
    "confirmado",
    "aceito",
    "aceita",
    "blz",
    "beleza",
    "bora",
    "pode ir",
    "pode seguir",
    "ta certo",
    "tá certo",
    "esta certo",
    "está certo",
    "certinho",
    "perfeito",
    "exato",
    "e isso",
    "eh isso",
    "pode confirmar",
    "so confirma",
    "só confirma",
    "fecha ai",
    "fecha aí",
];

const NEGATION_PHRASES = [
    "nao",
    "não",
    "cancela",
    "cancelar",
    "desist",
    "errado",
    "mudar",
    "muda o endereco",
    "muda o endereço",
    "troca",
    "outro endereco",
    "outro endereço",
    "nao quero",
    "não quero",
];

/** True se o texto curto parece aceitar o resumo do pedido (gírias extensíveis). */
export function isPortugueseOrderConfirmation(text: string): boolean {
    const n = normalize(text);
    if (n.length < 2 || n.length > 120) return false;
    if (NEGATION_PHRASES.some((p) => n.includes(normalize(p)))) return false;
    return CONFIRM_PHRASES.some((p) => n.includes(normalize(p)));
}

export function isPortugueseOrderRejection(text: string): boolean {
    const n = normalize(text);
    if (n.length < 2 || n.length > 120) return false;
    return NEGATION_PHRASES.some((p) => n.includes(normalize(p)));
}
