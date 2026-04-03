/**
 * Monta o objeto de cliente Pagar.me (PIX / orders) a partir da linha companies.
 * Usado pelo cron de cobrança e pelo checkout de mensalidade — mesma origem de CNPJ/nome.
 */

import "server-only";

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
    const fromCol = (company.cnpj ?? "").replace(/\D/g, "");
    if (fromCol) return fromCol;
    const meta = company.meta as { cnpj?: string } | null | undefined;
    return (meta?.cnpj ?? "").replace(/\D/g, "");
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
    const cnpjDigits = extractCompanyCnpjDigits(company);
    const isCpf      = cnpjDigits.length === 11;
    return {
        name:          displayName,
        email:         company.email ?? `${company.id}@renthus.com.br`,
        type:          isCpf ? "individual" : "company",
        document:      cnpjDigits || undefined,
        document_type: cnpjDigits ? (isCpf ? "CPF" : "CNPJ") : undefined,
        phone:         company.whatsapp_phone ?? undefined,
    };
}
