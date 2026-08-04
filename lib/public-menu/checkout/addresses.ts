import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PublicMenuSavedAddress } from "@/src/types/contracts.public-menu";

export async function listCustomerAddressesForMenu(
    admin: SupabaseClient,
    companyId: string,
    customerId: string
): Promise<PublicMenuSavedAddress[]> {
    const { data, error } = await admin
        .from("enderecos_cliente")
        .select("id, apelido, logradouro, numero, complemento, bairro, cidade, estado, cep, is_principal")
        .eq("company_id", companyId)
        .eq("customer_id", customerId)
        .order("is_principal", { ascending: false })
        .limit(8);

    if (error || !data) {
        if (error) console.error("[public-menu] list addresses:", error.message);
        return [];
    }

    return data.map((row) => {
        const logradouro = String(row.logradouro ?? "");
        const numero = row.numero == null ? "" : String(row.numero);
        const bairro = row.bairro == null ? "" : String(row.bairro);
        const line = [logradouro, numero].filter(Boolean).join(", ");
        const description = [line, bairro].filter(Boolean).join(" — ");
        return {
            id: String(row.id),
            title: String(row.apelido ?? "Endereço").trim() || "Endereço",
            description,
            logradouro,
            numero: numero || null,
            complemento: row.complemento == null ? null : String(row.complemento),
            bairro: bairro || null,
            cidade: String(row.cidade ?? ""),
            estado: String(row.estado ?? "").slice(0, 2).toUpperCase(),
            cep: row.cep == null ? null : String(row.cep),
            isPrincipal: Boolean(row.is_principal),
        };
    });
}

export function formatDeliveryAddressText(a: {
    logradouro: string;
    numero?: string | null;
    complemento?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    estado?: string | null;
}): string {
    const parts = [
        [a.logradouro.trim(), (a.numero ?? "").trim()].filter(Boolean).join(", "),
        (a.complemento ?? "").trim(),
        (a.bairro ?? "").trim(),
        [a.cidade?.trim(), a.estado?.trim()].filter(Boolean).join(" - "),
    ].filter(Boolean);
    return parts.join(" · ");
}
