import type { CepLookupResult } from "@/lib/address/cepLookup";
import type { SavedCustomerAddress } from "@/lib/whatsapp/types";

/** Formulário de endereço do carrinho do atendente (inbox). */
export type AddressForm = {
    logradouro: string;
    numero: string;
    complemento: string;
    bairro: string;
    cidade: string;
    estado: string;
    cep: string;
};

export const EMPTY_ADDRESS_FORM: AddressForm = {
    logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", estado: "", cep: "",
};

/** Só dígitos, no máximo 8 — mesmo contrato de `sanitizeCep` do lookup server-side. */
export function cepDigits(raw: string): string {
    return raw.replace(/\D/gu, "").slice(0, 8);
}

/** Máscara de exibição: 78898075 → 78898-075 (parcial enquanto digita). */
export function formatCepInput(raw: string): string {
    const d = cepDigits(raw);
    return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/** Linha curta do endereço salvo, pro seletor: "Rua X, 123 — Centro". */
export function describeSavedAddress(a: SavedCustomerAddress): string {
    const rua = [a.logradouro, a.numero].filter(Boolean).join(", ");
    return [rua, a.bairro].filter(Boolean).join(" — ") || a.cep || "Endereço sem detalhes";
}

/** Endereço salvo → formulário, sem perder cidade/UF da área de atendimento. */
export function savedAddressToForm(
    a: SavedCustomerAddress,
    defaults: { cidade: string; estado: string }
): AddressForm {
    return {
        logradouro: a.logradouro,
        numero: a.numero,
        complemento: a.complemento,
        bairro: a.bairro,
        cidade: a.cidade || defaults.cidade,
        estado: (a.estado || defaults.estado).toUpperCase().slice(0, 2),
        cep: formatCepInput(a.cep),
    };
}

/**
 * Preenche só o que está vazio. Usado ao abrir a gaveta: o carrinho do bot manda
 * o endereço que o cliente já deu, e a cidade/UF da empresa entram no buraco.
 */
export function withServiceAreaDefaults(
    form: AddressForm,
    defaults: { cidade: string; estado: string }
): AddressForm {
    return {
        ...form,
        cidade: form.cidade.trim() || defaults.cidade,
        estado: (form.estado.trim() || defaults.estado).toUpperCase().slice(0, 2),
    };
}

/**
 * Resultado do ViaCEP sobre o formulário: rua/bairro/cidade/UF vêm do CEP
 * (é o motivo de consultar), número e complemento são do atendente e ficam.
 */
export function applyCepLookup(form: AddressForm, lookup: CepLookupResult): AddressForm {
    return {
        ...form,
        logradouro: lookup.logradouro || form.logradouro,
        bairro: lookup.bairro || form.bairro,
        cidade: lookup.localidade || form.cidade,
        estado: (lookup.uf || form.estado).toUpperCase().slice(0, 2),
        cep: formatCepInput(lookup.cep),
    };
}

/** Endereço válido pra entrega: rua, número, bairro, cidade e UF. */
export function isAddressFormComplete(form: AddressForm): boolean {
    return Boolean(
        form.logradouro.trim() &&
        form.numero.trim() &&
        form.bairro.trim() &&
        form.cidade.trim() &&
        form.estado.trim().length >= 2
    );
}
