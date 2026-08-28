import {
    isGenericCustomerDisplayName,
    normalizeCustomerDisplayName,
} from "@/lib/meta/customerDisplayName";

/**
 * Após vincular telefone (IG/Messenger → cadastro):
 * - Nome digitado no form (não genérico) tem prioridade
 * - Cadastro existente com nome real é preservado no merge
 * - Nome do canal (Meta) só enriquece se o cadastro ainda for genérico
 */
export function pickCustomerNameAfterPhoneLink(params: {
    existingName?: string | null;
    formName?: string | null;
    channelName?: string | null;
}): string | null {
    const form = normalizeCustomerDisplayName(params.formName);
    const existing = normalizeCustomerDisplayName(params.existingName);
    const channel = normalizeCustomerDisplayName(params.channelName);

    if (form && !isGenericCustomerDisplayName(form)) return form.slice(0, 120);
    if (existing && !isGenericCustomerDisplayName(existing)) return existing.slice(0, 120);
    if (channel && !isGenericCustomerDisplayName(channel)) return channel.slice(0, 120);
    return form || existing || channel || null;
}
