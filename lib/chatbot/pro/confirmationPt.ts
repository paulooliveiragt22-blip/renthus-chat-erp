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

/** IDs de botão WhatsApp (incoming usa `button_reply.id` como texto). */
const CONFIRM_BUTTON_IDS = new Set([
    "confirmar",
    "confirmar_pedido",
    "confirm_order",
    "pro_confirm_order",
    "btn_confirm_order",
    "btn_confirmar",
]);

const REJECT_BUTTON_IDS = new Set([
    "cancelar",
    "cancelar_pedido",
    "btn_cancel",
    "btn_cancelar",
]);

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
    if (CONFIRM_BUTTON_IDS.has(n)) return true;
    if (REJECT_BUTTON_IDS.has(n)) return false;
    if (NEGATION_PHRASES.some((p) => n.includes(normalize(p)))) return false;
    return CONFIRM_PHRASES.some((p) => n.includes(normalize(p)));
}

export function isPortugueseOrderRejection(text: string): boolean {
    const n = normalize(text);
    if (n.length < 2 || n.length > 120) return false;
    if (REJECT_BUTTON_IDS.has(n)) return true;
    return NEGATION_PHRASES.some((p) => n.includes(normalize(p)));
}
