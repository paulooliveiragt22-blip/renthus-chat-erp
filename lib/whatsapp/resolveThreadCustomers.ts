import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeBrazilToE164 } from "@/lib/whatsapp/phone";

export type ThreadCustomerMatch = {
    /** Cadastros que batem com o telefone da thread (duplicados incluídos). */
    customerIds: string[];
    /** Nome preferido entre os duplicados (evita o genérico "Cliente WhatsApp"). */
    preferredName: string | null;
};

/**
 * Acha os cadastros de `customers` do telefone da thread — **sem criar** nada
 * (diferente de `getOrCreateCustomer`, que é pra fluxo de pedido).
 *
 * `customers.phone` não tem formato único no banco: há registros em E.164
 * completo (+5566992285005), sem código de país e sem o "9" de celular —
 * cadastro antigo de PDV/admin grava o que foi digitado. Match exato perde
 * cliente com histórico real sempre que o formato divergir do `phone_e164` da
 * thread, então buscamos candidatos pelos últimos 8 dígitos (parte fixa do
 * número local em qualquer formato) e confirmamos com `normalizeBrazilToE164`.
 */
export async function resolveThreadCustomers(
    admin: SupabaseClient,
    companyId: string,
    phoneE164: string
): Promise<ThreadCustomerMatch> {
    const digits = phoneE164.replace(/\D/g, "");
    const last8 = digits.slice(-8);
    if (last8.length < 8) return { customerIds: [], preferredName: null };

    const targetE164 = normalizeBrazilToE164(phoneE164);

    const { data: candidates, error } = await admin
        .from("customers")
        .select("id, name, phone")
        .eq("company_id", companyId)
        .not("phone", "is", null)
        .ilike("phone", `%${last8}`);
    if (error) throw error;

    const matches = (candidates ?? []).filter(
        (c) => c.phone && normalizeBrazilToE164(String(c.phone)) === targetE164
    );
    if (matches.length === 0) return { customerIds: [], preferredName: null };

    return {
        customerIds: [...new Set(matches.map((c) => String(c.id)))],
        preferredName:
            (matches.find((c) => c.name && !/^cliente\s*whatsapp$/i.test(String(c.name)))?.name as
                | string
                | null) ??
            (matches[0]?.name as string | null) ??
            null,
    };
}
