// lib/agents/requireAgent.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const supabaseAdmin = createAdminClient();

/**
 * Try to split token into prefix + secret.
 * Expected format: "<prefix>.<secret>"
 * If not in that format, fallback to first N chars as prefix (8) and rest as secret.
 */
function splitToken(token: string) {
    if (!token) return { prefix: "", secret: "" };
    if (token.includes(".")) {
        const [p, s] = token.split(".", 2);
        return { prefix: p, secret: s };
    }
    // fallback: prefix = first 8 chars
    return { prefix: token.slice(0, 8), secret: token.slice(8) };
}

async function verifyByPrintAgents(prefix: string, secret: string) {
    // try to find print_agent by api_key_prefix
    const { data: agentRows, error } = await supabaseAdmin
        .from("print_agents")
        .select("*")
        .eq("api_key_prefix", prefix)
        .limit(1)
        .maybeSingle();

    if (error) throw new Error(error.message);
    if (!agentRows) return null;

    const agent = agentRows as any;
    const hash = agent.api_key_hash as string | null;

    if (!hash || !secret) return null;

    // if bcrypt-style hash -> use bcrypt
    if (hash.startsWith("$2a$") || hash.startsWith("$2b$") || hash.startsWith("$2y$")) {
        const ok = bcrypt.compareSync(secret, hash);
        if (ok) return agent;
        return null;
    }

    // fallback: compare sha256 hex
    const sha = crypto.createHash("sha256").update(secret).digest("hex");
    if (sha === hash) return agent;

    return null;
}

async function verifyByDownloadTokens(prefix: string, secret: string) {
    // look up token row (agent_download_tokens) and join print_agents
    const { data: tokenRow, error } = await supabaseAdmin
        .from("agent_download_tokens")
        .select("*, print_agents(*)")
        .eq("token_prefix", prefix)
        .limit(1)
        .maybeSingle();

    if (error) throw new Error(error.message);
    if (!tokenRow) return null;

    // check expiration / used flags
    const expiresAt = tokenRow.expires_at ? new Date(tokenRow.expires_at) : null;
    if (expiresAt && expiresAt < new Date()) return null;
    if (tokenRow.used) return null;

    const tokenHash = tokenRow.token_hash as string | null;
    if (!tokenHash || !secret) return null;

    if (tokenHash.startsWith("$2a$") || tokenHash.startsWith("$2b$") || tokenHash.startsWith("$2y$")) {
        const ok = bcrypt.compareSync(secret, tokenHash);
        if (!ok) return null;
    } else {
        const sha = crypto.createHash("sha256").update(secret).digest("hex");
        if (sha !== tokenHash) return null;
    }

    // optionally: mark token as used (if single-use). You can decide the semantics.
    // await supabaseAdmin.from("agent_download_tokens").update({ used: true, used_at: new Date().toISOString() }).eq("id", tokenRow.id);

    // return the related print_agent if present, or minimal agent_id
    if (tokenRow.print_agents && tokenRow.print_agents.id) return tokenRow.print_agents;
    return { id: tokenRow.agent_id };
}

/**
 * Main exported function to require agent auth.
 * Returns { ok: true, agent } or { ok:false, status, error } like other middlewares.
 */
export async function requireAgent(req: Request) {
    try {
        const auth = req.headers.get("authorization") ?? "";
        if (!auth.startsWith("Bearer ")) return { ok: false, status: 401, error: "missing_authorization" };
        const token = auth.slice("Bearer ".length).trim();
        if (!token) return { ok: false, status: 401, error: "missing_token" };

        const { prefix, secret } = splitToken(token);

        // 1) try print_agents by prefix
        const agentFromAgents = await verifyByPrintAgents(prefix, secret);
        if (agentFromAgents) {
            // update last_seen (async)
            supabaseAdmin.from("print_agents").update({ last_seen: new Date().toISOString() }).eq("id", agentFromAgents.id);
            return { ok: true, agent: agentFromAgents };
        }

        // 2) try agent_download_tokens (fallback)
        const agentFromToken = await verifyByDownloadTokens(prefix, secret);
        if (agentFromToken) {
            supabaseAdmin.from("print_agents").update({ last_seen: new Date().toISOString() }).eq("id", agentFromToken.id);
            return { ok: true, agent: agentFromToken };
        }

        return { ok: false, status: 403, error: "invalid_agent_token" };
    } catch (e: any) {
        return { ok: false, status: 500, error: e?.message ?? "unexpected" };
    }
}
