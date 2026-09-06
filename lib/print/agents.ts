// lib/print/agents.ts
import { verifyPrintAgentApiKey } from "@/lib/agent/verifyPrintAgentApiKey";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Verifica apiKey do agent e retorna subset seguro (ou null).
 * Delega a verifyPrintAgentApiKey (strip rpa_, exige is_active).
 */
export async function verifyAgentByApiKey(apiKey: string) {
    const v = await verifyPrintAgentApiKey(apiKey);
    if (!v.ok) return null;
    return {
        id: v.agent.id,
        company_id: v.agent.company_id,
        name: v.agent.name,
        is_active: true as const,
    };
}

/** Atualiza last_seen do agente (opcional) */
export async function updateAgentLastSeen(agentId: string) {
    try {
        const admin = createAdminClient();
        await admin
            .from("print_agents")
            .update({ last_seen: new Date().toISOString() })
            .eq("id", agentId);
    } catch {
        // ignore
    }
}
