import { parseCardExpiry } from "@/lib/pagarme/cardTokenBrowser";
import type { RenthusBillingAddr, RenthusCardForm } from "@/lib/billing/planBillingTypes";

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
    const exp = parseCardExpiry(renthusCard.exp);
    if (!exp) return { error: "Validade do cartão: use MM/AA." };
    const num = renthusCard.number.replaceAll(/\D/g, "");
    if (num.length < 13) return { error: "Número do cartão inválido." };
    const cvv = renthusCard.cvv.replaceAll(/\D/g, "");
    if (cvv.length < 3) return { error: "CVV inválido." };
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
