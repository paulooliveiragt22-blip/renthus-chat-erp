// lib/print/agents.ts
import bcrypt from "bcryptjs";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Verifica apiKey do agent e retorna a row do agente (ou null).
 * Usa createAdminClient() (service role) para buscar na tabela print_agents.
 */
export async function verifyAgentByApiKey(apiKey: string) {
  if (!apiKey || apiKey.length < 8) return null;
  const admin = createAdminClient();
  const prefix = apiKey.slice(0, 8);
  const { data: agent, error } = await admin
    .from("print_agents")
    .select("*")
    .eq("api_key_prefix", prefix)
    .maybeSingle();
  if (error || !agent) return null;
  const ok = await bcrypt.compare(apiKey, agent.api_key_hash);
  if (!ok) return null;
  return agent;
}

/** Atualiza last_seen do agente (opcional) */
export async function updateAgentLastSeen(agentId: string) {
  try {
    const admin = createAdminClient();
    await admin.from("print_agents").update({ last_seen: new Date().toISOString() }).eq("id", agentId);
  } catch (e) {
    // ignore
  }
}
