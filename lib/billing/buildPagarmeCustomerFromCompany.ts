/**
 * Monta o objeto de cliente Pagar.me (PIX / orders) a partir da linha companies.
 * Usado pelo cron de cobrança e pelo checkout de mensalidade — mesma origem de CNPJ/nome.
 */

import "server-only";

import { classifyFiscalDocument, onlyFiscalDigits } from "@/lib/billing/brazilianFiscalDocument";

export type CompanyRowForPagarme = {
    id: string;
    name: string | null;
    nome_fantasia?: string | null;
    email: string | null;
    whatsapp_phone: string | null;
    cnpj?: string | null;
    meta?: Record<string, unknown> | null;
};

export function extractCompanyCnpjDigits(company: CompanyRowForPagarme): string {
    const fromCol = onlyFiscalDigits(company.cnpj);
    if (fromCol) return fromCol;
    const meta = company.meta as { cnpj?: string } | null | undefined;
    return onlyFiscalDigits(meta?.cnpj);
}

export function buildPagarmeCustomerPayload(company: CompanyRowForPagarme): {
    name:           string;
    email:          string;
    type:           "individual" | "company";
    document?:      string;
    document_type?: "CPF" | "CNPJ";
    phone?:         string;
} {
    const displayName =
        (company.nome_fantasia ?? "").trim() ||
        (company.name ?? "").trim() ||
        "Empresa";
    const classified = classifyFiscalDocument(extractCompanyCnpjDigits(company));
    const payload: {
        name:           string;
        email:          string;
        type:           "individual" | "company";
        document?:      string;
        document_type?: "CPF" | "CNPJ";
        phone?:         string;
    } = {
        name:  displayName,
        email: company.email ?? `${company.id}@renthus.com.br`,
        type:  classified.valid && classified.kind === "CPF" ? "individual" : "company",
        phone: company.whatsapp_phone ?? undefined,
    };
    if (classified.valid) {
        payload.document      = classified.digits;
        payload.document_type = classified.kind;
    }
    return payload;
}
