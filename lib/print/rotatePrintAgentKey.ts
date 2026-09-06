import "server-only";

import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { SupabaseClient } from "@supabase/supabase-js";

export type RotatedPrintAgentKey = {
    apiKeyPlain: string;
    prefix: string;
    hash: string;
};

/** Gera material de key no formato canônico `rpa_{80 hex}`. */
export async function generatePrintAgentKeyMaterial(): Promise<RotatedPrintAgentKey> {
    const rawKey = crypto.randomBytes(40).toString("hex");
    const prefix = rawKey.slice(0, 8);
    const hash = await bcrypt.hash(rawKey, 10);
    return {
        apiKeyPlain: `rpa_${rawKey}`,
        prefix,
        hash,
    };
}

/**
 * Rotaciona a API key de um agente ativo: invalida a anterior e devolve a nova
 * plaintext uma vez. Escopo por company_id obrigatório.
 */
export async function rotatePrintAgentApiKey(
    admin: SupabaseClient,
    params: { agentId: string; companyId: string }
): Promise<{ ok: true; apiKey: string; prefix: string } | { ok: false; error: string }> {
    const material = await generatePrintAgentKeyMaterial();
    const { data, error } = await admin
        .from("print_agents")
        .update({
            api_key_hash: material.hash,
            api_key_prefix: material.prefix,
        })
        .eq("id", params.agentId)
        .eq("company_id", params.companyId)
        .eq("is_active", true)
        .select("id")
        .maybeSingle();

    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: "agent_not_found_or_inactive" };
    return { ok: true, apiKey: material.apiKeyPlain, prefix: material.prefix };
}

/**
 * Revoga: desativa e scramble o hash para a key antiga nunca autenticar de novo
 * (mesmo se alguém reativar a row sem rotacionar).
 */
export async function revokePrintAgentApiKey(
    admin: SupabaseClient,
    params: { agentId: string; companyId: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
    const dead = await generatePrintAgentKeyMaterial();
    const { data, error } = await admin
        .from("print_agents")
        .update({
            is_active: false,
            api_key_hash: dead.hash,
            api_key_prefix: dead.prefix,
        })
        .eq("id", params.agentId)
        .eq("company_id", params.companyId)
        .select("id")
        .maybeSingle();

    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: "agent_not_found" };
    return { ok: true };
}
