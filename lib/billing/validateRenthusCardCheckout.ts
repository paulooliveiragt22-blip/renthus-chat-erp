import { parseCardExpiry } from "@/lib/pagarme/cardTokenBrowser";
import { classifyFiscalDocument } from "@/lib/billing/brazilianFiscalDocument";
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
          holderDocument: string;
          addrCep: string;
      } {
    const expRaw = renthusCard.exp.trim();
    if (!/^\d{2}\/\d{2}$/.test(expRaw)) {
        return { error: "Confira a validade. Use mês e ano, como 08/28." };
    }
    const exp = parseCardExpiry(expRaw);
    if (!exp) return { error: "Confira a validade. Use mês e ano, como 08/28." };
    const month = Number(exp.month);
    if (month < 1 || month > 12) {
        return { error: "O mês de validade não existe. Use de 01 a 12." };
    }
    const year2 = Number(exp.year);
    if (isExpiryInPast(month, year2)) {
        return { error: "Este cartão está vencido. Informe uma validade que ainda não passou." };
    }
    const num = renthusCard.number.replaceAll(/\D/g, "");
    if (num.length < 13 || num.length > 19) {
        return { error: "O número do cartão não foi aceito. Confira os dígitos." };
    }
    const cvv = renthusCard.cvv.replaceAll(/\D/g, "");
    if (cvv.length < 3 || cvv.length > 4) {
        return { error: "O código de segurança tem 3 ou 4 dígitos. Confira no verso do cartão." };
    }
    const holder = renthusCard.holder.trim() || nomeFantasia.trim();
    if (holder.length < 3) {
        return {
            error: "Informe o nome no cartão ou preencha o nome fantasia da empresa.",
        };
    }
    const holderDoc = classifyFiscalDocument(renthusCard.holder_document);
    if (!holderDoc.valid) {
        return {
            error: "Informe o CPF ou CNPJ válido do titular do cartão.",
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
    return {
        exp,
        num,
        cvv,
        holder,
        holderDocument: holderDoc.digits,
        addrCep,
    };
}
