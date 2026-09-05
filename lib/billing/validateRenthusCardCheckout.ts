import { parseCardExpiry } from "@/lib/pagarme/cardTokenBrowser";
import type { RenthusBillingAddr, RenthusCardForm } from "@/lib/billing/planBillingTypes";

function isExpiryInPast(month: number, year2: number): boolean {
    const now = new Date();
    const curYear = now.getFullYear() % 100;
    const curMonth = now.getMonth() + 1;
    if (year2 < curYear) return true;
    if (year2 === curYear && month < curMonth) return true;
    return false;
}

/** Retorna mensagem de erro ou dados prontos para token + checkout. */
export function validateRenthusCardCheckout(
    renthusCard: RenthusCardForm,
    cardAddr: RenthusBillingAddr,
    nomeFantasia: string
):
    | { error: string }
    | {
          exp: { month: string; year: string };
          num: string;
          cvv: string;
          holder: string;
          addrCep: string;
      } {
    const expRaw = renthusCard.exp.trim();
    if (!/^\d{2}\/\d{2}$/.test(expRaw)) {
        return { error: "Validade do cartão: use MM/AA (ex.: 08/28)." };
    }
    const exp = parseCardExpiry(expRaw);
    if (!exp) return { error: "Validade do cartão: use MM/AA." };
    const month = Number(exp.month);
    if (month < 1 || month > 12) {
        return { error: "Mês de validade inválido (01–12)." };
    }
    const year2 = Number(exp.year);
    if (isExpiryInPast(month, year2)) {
        return { error: "Cartão vencido. Informe uma validade futura." };
    }
    const num = renthusCard.number.replaceAll(/\D/g, "");
    if (num.length < 13 || num.length > 19) {
        return { error: "Número do cartão inválido." };
    }
    const cvv = renthusCard.cvv.replaceAll(/\D/g, "");
    if (cvv.length < 3 || cvv.length > 4) {
        return { error: "CVV inválido (3 ou 4 dígitos)." };
    }
    const holder = renthusCard.holder.trim() || nomeFantasia.trim();
    if (holder.length < 3) {
        return {
            error: "Informe o nome no cartão ou preencha o nome fantasia da empresa.",
        };
    }
    const addrCep = cardAddr.cep.replaceAll(/\D/g, "");
    if (
        !cardAddr.endereco.trim() ||
        !cardAddr.numero.trim() ||
        !cardAddr.cidade.trim() ||
        cardAddr.uf.length < 2
    ) {
        return {
            error: "Preencha o endereço de cobrança (CEP, endereço, número, cidade e UF).",
        };
    }
    if (addrCep.length < 8) {
        return { error: "CEP inválido." };
    }
    return { exp, num, cvv, holder, addrCep };
}
