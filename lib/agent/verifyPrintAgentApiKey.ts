import { createAdminClient } from "@/lib/supabase/admin";
import bcrypt from "bcryptjs";

export type VerifiedPrintAgent = {
    id: string;
    company_id: string;
    name: string;
};

export async function verifyPrintAgentApiKey(rawKey: string): Promise<
    | { ok: true; agent: VerifiedPrintAgent }
    | { ok: false; status: number; error: string }
> {
    if (!rawKey?.trim()) {
        return { ok: false, status: 400, error: "api_key obrigatório" };
    }

    const stripped = rawKey.startsWith("rpa_") ? rawKey.slice(4) : rawKey;
    const prefix = stripped.slice(0, 8);
    if (prefix.length < 8) {
        return { ok: false, status: 401, error: "api_key inválida" };
    }

    const admin = createAdminClient();
    const { data: agents, error: fetchErr } = await admin
        .from("print_agents")
        .select("id, company_id, name, api_key_hash, is_active")
        .eq("api_key_prefix", prefix)
        .eq("is_active", true)
        .limit(5);

    if (fetchErr) {
        console.error("[agent] DB error:", fetchErr.message);
        return { ok: false, status: 500, error: "Erro interno" };
    }

    if (!agents?.length) {
        return { ok: false, status: 401, error: "api_key inválida ou agent desativado" };
    }

    let matched: (typeof agents)[0] | null = null;
    for (const agent of agents) {
        if (await bcrypt.compare(stripped, agent.api_key_hash)) {
            matched = agent;
            break;
        }
    }

    if (!matched) {
        return { ok: false, status: 401, error: "api_key inválida" };
    }

    return {
        ok: true,
        agent: { id: matched.id, company_id: matched.company_id, name: matched.name },
    };
}
