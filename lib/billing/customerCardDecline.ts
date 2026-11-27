/**
 * Recusa de cartão no checkout, na voz de quem paga.
 * Fonte: códigos Pagar.me da tabela ABECS (docs.pagar.me). A coluna do lojista
 * ("oriente o usuário") não vai para a tela.
 */

export type CardDeclineInput = {
    returnCode?: string | null;
    acquirerMessage?: string | null;
    gatewayMessage?: string | null;
};

const PIX = "Ou pague com PIX.";

const INVALID_NUMBER = `O número do cartão não foi aceito. Confira os dígitos ou fale com o banco que emitiu o cartão. ${PIX}`;
const EXPIRED = `Este cartão está vencido ou a validade está incorreta. Confira a data ou use outro cartão. ${PIX}`;
const BAD_CVV = `O código de segurança não confere. Confira o CVV no verso do cartão. ${PIX}`;
const NO_FUNDS = `O banco recusou por falta de limite ou saldo. Tente outro cartão ou pague com PIX.`;
const CALL_BANK = `O banco não autorizou esta compra. Fale com o emissor do cartão ou pague com PIX.`;
const CHECK_OR_CALL = `O banco recusou este cartão. Confira os dados ou fale com o emissor. ${PIX}`;
const NOT_ALLOWED = `Este cartão não pode concluir este pagamento. Use outro cartão ou pague com PIX.`;
const BAD_AMOUNT = `O banco não aceitou o valor desta cobrança. Tente outro cartão ou pague com PIX.`;
const BAD_INSTALLMENT = `Este cartão não aceita esta forma de pagamento. Tente à vista, outro cartão ou PIX.`;
const TRY_LATER = `O banco do cartão não respondeu agora. Tente de novo em alguns minutos ou pague com PIX.`;
const SYSTEM = `Não foi possível concluir agora. Tente de novo em alguns minutos ou pague com PIX.`;
const CANCELLED = `Este cartão está cancelado. Use outro cartão ou pague com PIX.`;
const BAD_PASSWORD = `A senha do cartão não confere. Confira e tente de novo, ou pague com PIX.`;
const RESTRICTED = `Este cartão tem uma restrição. Fale com o banco ou use outro cartão. ${PIX}`;
const GENERIC = `O banco não autorizou este cartão. Confira os dados ou pague com PIX.`;

/** Código Pagar.me (coluna estável da tabela ABECS) → frase do cliente. */
const BY_CODE: Record<string, string> = {
    "1000": CALL_BANK,
    "1001": EXPIRED,
    "1004": RESTRICTED,
    "1007": CHECK_OR_CALL,
    "1009": SYSTEM,
    "1010": BAD_AMOUNT,
    "1011": INVALID_NUMBER,
    "1014": CHECK_OR_CALL,
    "1015": BAD_INSTALLMENT,
    "1016": NO_FUNDS,
    "1017": BAD_PASSWORD,
    "1019": NOT_ALLOWED,
    "1020": SYSTEM,
    "1022": CHECK_OR_CALL,
    "1035": CANCELLED,
    "1040": CALL_BANK,
    "1045": BAD_CVV,
    "2000": NOT_ALLOWED,
    "2002": CALL_BANK,
    "2008": NOT_ALLOWED,
    "2009": NOT_ALLOWED,
    "9102": GENERIC,
    "9103": TRY_LATER,
    "9107": TRY_LATER,
    "9108": INVALID_NUMBER,
    "9109": SYSTEM,
    "9112": TRY_LATER,
};

function codeOf(raw: string | null | undefined): string | null {
    const digits = String(raw ?? "").replace(/\D/gu, "");
    return digits.length > 0 ? digits : null;
}

function fromText(text: string): string | null {
    const folded = text.toLocaleLowerCase("pt-BR");
    if (/n[uú]mero do cart[aã]o|n[ºo]\s*cart[aã]o inv[aá]lido|not a valid card number/u.test(folded)) {
        return INVALID_NUMBER;
    }
    if (/cart[aã]o vencido|vencimento incorreta|expir/u.test(folded)) return EXPIRED;
    if (/c[oó]digo de seguran[cç]a|cvv|security code/u.test(folded)) return BAD_CVV;
    if (/saldo insuficiente|limite insuficiente/u.test(folded)) return NO_FUNDS;
    if (/senha/u.test(folded)) return BAD_PASSWORD;
    if (/perda ou roubo|cart[aã]o cancelado|conta encerrada/u.test(folded)) return CANCELLED;
    if (/indispon[ií]vel|offline|fora do ar/u.test(folded)) return TRY_LATER;
    if (/oriente o (usu[aá]rio|portador)|contatar o banco|contate a central/u.test(folded)) {
        return CALL_BANK;
    }
    return null;
}

export function customerCardDeclineMessage(input: CardDeclineInput): string {
    const code = codeOf(input.returnCode);
    if (code && BY_CODE[code]) return BY_CODE[code];
    const text = [input.acquirerMessage, input.gatewayMessage].filter(Boolean).join(" ");
    return fromText(text) ?? GENERIC;
}
