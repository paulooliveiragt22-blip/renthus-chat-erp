import type { SupabaseClient } from "@supabase/supabase-js";

export type FlowEnderecoPayload = {
    apelido: string;
    logradouro: string;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    cidade: string;
    estado: string;
    cep: string | null;
};

/**
 * Persiste endereço do cliente só via RPC (sem INSERT direto na app).
 * Atualização por `address_id` usa upsert existente; criação usa `rpc_chatbot_pro_create_customer_address`.
 */
export async function persistEnderecoClienteFromFlow(
    admin: SupabaseClient,
    params: {
        companyId: string;
        customerId: string;
        existingAddressId: string | null;
    } & FlowEnderecoPayload
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
    const uf = params.estado.trim().toUpperCase().slice(0, 2);
    if (!params.cidade.trim() || uf.length !== 2) {
        return { ok: false, message: "cidade_estado_obrigatorios" };
    }
    const basePayload: Record<string, unknown> = {
        apelido:       params.apelido.trim() || "WhatsApp",
        logradouro:    params.logradouro.trim(),
        numero:        (params.numero ?? "").trim(),
        complemento:   (params.complemento ?? "").trim(),
        bairro:        (params.bairro ?? "").trim(),
        cidade:        params.cidade.trim(),
        estado:        uf,
        cep:           (params.cep ?? "").replace(/\D/g, "").slice(0, 8),
        is_principal:  true,
    };
    if (params.existingAddressId) {
        const { data, error } = await admin.rpc("rpc_chatbot_pro_upsert_endereco_cliente", {
            p_company_id:  params.companyId,
            p_customer_id: params.customerId,
            p_payload:     { ...basePayload, address_id: params.existingAddressId },
        });
        if (error || !data) {
            return { ok: false, message: error?.message ?? "upsert_endereco_failed" };
        }
        return { ok: true, id: String(data) };
    }
    const { data, error } = await admin.rpc("rpc_chatbot_pro_create_customer_address", {
        p_company_id:  params.companyId,
        p_customer_id: params.customerId,
        p_payload:     basePayload,
    });
    if (error || !data) {
        return { ok: false, message: error?.message ?? "create_endereco_failed" };
    }
    return { ok: true, id: String(data) };
}
