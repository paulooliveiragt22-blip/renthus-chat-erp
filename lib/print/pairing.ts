/**
 * Pareamento do Print Agent: código curto (8 chars) one-time + TTL.
 * API key fica só no hash do agente; plaintext criptografado no token até o activate.
 */

import "server-only";

import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { encryptCredential, decryptCredential } from "@/lib/security/credentialCrypto";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generatePairingCode(length = 8): string {
    const bytes = crypto.randomBytes(length);
    let out = "";
    for (let i = 0; i < length; i++) {
        out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
    }
    return out;
}

export async function createAgentWithPairingCode(
    admin: SupabaseClient,
    params: {
        companyId: string;
        agentName?: string;
        createdBy?: string | null;
        ttlMinutes?: number;
    }
): Promise<{
    agentId: string;
    agentName: string;
    code: string;
    expiresAt: string;
    apiKeyPrefix: string;
}> {
    const ttl = Math.min(60, Math.max(5, params.ttlMinutes ?? 15));
    const now = new Date();
    const defaultName = `Agente - ${now.toLocaleDateString("pt-BR")} ${now.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
    })}`;
    const agentName = params.agentName?.trim() || defaultName;

    const encryptedProbe = encryptCredential("probe");
    if (!encryptedProbe) {
        throw new Error(
            "encryption_unavailable: defina CREDENTIALS_ENCRYPTION_KEY (32 bytes base64)."
        );
    }

    await admin
        .from("print_agents")
        .update({ is_active: false })
        .eq("company_id", params.companyId)
        .eq("is_active", true);

    const rawKey = crypto.randomBytes(40).toString("hex");
    const apiKeyPlain = `rpa_${rawKey}`;
    const prefix = rawKey.slice(0, 8);
    const hash = await bcrypt.hash(rawKey, 10);

    const { data: agent, error: insertErr } = await admin
        .from("print_agents")
        .insert([
            {
                company_id: params.companyId,
                name: agentName,
                api_key_hash: hash,
                api_key_prefix: prefix,
                is_active: true,
            },
        ])
        .select("id, name, api_key_prefix")
        .single();

    if (insertErr || !agent) {
        throw new Error(insertErr?.message ?? "Erro ao criar agente");
    }

    // Remove códigos anteriores não usados deste agente
    await admin
        .from("agent_download_tokens")
        .delete()
        .eq("agent_id", agent.id)
        .eq("used", false);

    const expiresAt = new Date(Date.now() + ttl * 60_000).toISOString();
    let code = generatePairingCode(8);

    // Evita colisão rara de prefixo ativo
    for (let attempt = 0; attempt < 5; attempt++) {
        const encryptedApiKey = encryptCredential(apiKeyPlain);
        if (!encryptedApiKey) throw new Error("encryption_unavailable");
        const tokenHash = await bcrypt.hash(code, 10);
        const { error } = await admin.from("agent_download_tokens").insert([
            {
                agent_id: agent.id,
                token_hash: tokenHash,
                token_prefix: code,
                encrypted_api_key: encryptedApiKey,
                expires_at: expiresAt,
                created_by: params.createdBy ?? null,
                used: false,
            },
        ]);
        if (!error) break;
        if (attempt === 4) throw new Error(error.message);
        code = generatePairingCode(8);
    }

    return {
        agentId: agent.id,
        agentName: agent.name,
        code,
        expiresAt,
        apiKeyPrefix: agent.api_key_prefix,
    };
}

export async function activatePairingCode(
    admin: SupabaseClient,
    rawCode: string
): Promise<
    | { ok: true; apiKey: string; agentId: string; companyId: string; serverHint: string }
    | { ok: false; error: string; status: number }
> {
    const code = String(rawCode ?? "")
        .trim()
        .toUpperCase()
        .replaceAll(/[^A-Z0-9]/g, "");
    if (code.length < 6 || code.length > 12) {
        return { ok: false, error: "invalid_code", status: 400 };
    }

    const nowIso = new Date().toISOString();
    const { data: rows, error } = await admin
        .from("agent_download_tokens")
        .select("id, agent_id, token_hash, encrypted_api_key, expires_at, used, print_agents(id, company_id, is_active)")
        .eq("token_prefix", code)
        .eq("used", false)
        .gt("expires_at", nowIso)
        .limit(5);

    if (error) return { ok: false, error: error.message, status: 500 };
    if (!rows?.length) return { ok: false, error: "code_not_found_or_expired", status: 404 };

    for (const row of rows) {
        const match = await bcrypt.compare(code, String(row.token_hash ?? ""));
        if (!match) continue;

        const apiKey = decryptCredential(row.encrypted_api_key as string | null);
        if (!apiKey) {
            return { ok: false, error: "decrypt_failed", status: 500 };
        }

        const agentRel = row.print_agents as
            | { id?: string; company_id?: string; is_active?: boolean }
            | { id?: string; company_id?: string; is_active?: boolean }[]
            | null;
        const agent = Array.isArray(agentRel) ? agentRel[0] : agentRel;
        if (!agent?.id || !agent.company_id) {
            return { ok: false, error: "agent_missing", status: 404 };
        }

        await admin.from("agent_download_tokens").delete().eq("id", row.id);

        await admin
            .from("print_agents")
            .update({ is_active: true, last_seen: new Date().toISOString() })
            .eq("id", agent.id);

        return {
            ok: true,
            apiKey,
            agentId: agent.id,
            companyId: agent.company_id,
            serverHint: process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "",
        };
    }

    return { ok: false, error: "code_not_found_or_expired", status: 404 };
}
