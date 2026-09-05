/**
 * Documento fiscal enviado ao Pagar.me.
 * Live: só CPF/CNPJ com checksum. Sandbox (sk_test_): fixture se o cadastro for inválido.
 * Nunca grava o fixture em `companies.cnpj`.
 */

import { classifyFiscalDocument } from "@/lib/billing/brazilianFiscalDocument";

/** CNPJ de teste já usado nos testes de billing (Receita / sandbox). */
export const PAGARME_SANDBOX_CNPJ = "11444777000161";

export const PAGARME_INVALID_DOCUMENT_ERROR =
    "CNPJ/CPF inválido. Corrija o documento em Configurações da empresa e tente de novo.";

export function isPagarmeTestEnv(
    apiKey = process.env.PAGARME_API_KEY,
    publicKey = process.env.NEXT_PUBLIC_PAGARME_PUBLIC_KEY
): boolean {
    const sk = apiKey?.trim() ?? "";
    const pk = publicKey?.trim() ?? "";
    return sk.startsWith("sk_test_") || pk.startsWith("pk_test_");
}

export type ResolvedPagarmeFiscalDocument = {
    digits: string;
    document_type: "CPF" | "CNPJ";
    type: "individual" | "company";
    usedSandboxFixture: boolean;
};

export function resolvePagarmeFiscalDocument(
    raw: string | null | undefined,
    opts?: { sandbox?: boolean }
): { ok: true; value: ResolvedPagarmeFiscalDocument } | { ok: false } {
    const classified = classifyFiscalDocument(raw);
    if (classified.valid) {
        return {
            ok: true,
            value: {
                digits: classified.digits,
                document_type: classified.kind,
                type: classified.kind === "CPF" ? "individual" : "company",
                usedSandboxFixture: false,
            },
        };
    }
    const sandbox = opts?.sandbox ?? isPagarmeTestEnv();
    if (sandbox) {
        return {
            ok: true,
            value: {
                digits: PAGARME_SANDBOX_CNPJ,
                document_type: "CNPJ",
                type: "company",
                usedSandboxFixture: true,
            },
        };
    }
    return { ok: false };
}

export function applyFiscalToPagarmeCustomer<
    T extends {
        document?: string;
        document_type?: "CPF" | "CNPJ";
        type?: "individual" | "company";
    },
>(payload: T, fiscal: ResolvedPagarmeFiscalDocument): T {
    return {
        ...payload,
        document: fiscal.digits,
        document_type: fiscal.document_type,
        type: fiscal.type,
    };
}
