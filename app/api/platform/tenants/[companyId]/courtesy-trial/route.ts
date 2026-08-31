import { NextResponse } from "next/server";
import { withPlatformAccess } from "@/lib/platform/apiHelpers";
import { ConsoleBillingNotifier } from "@/lib/billing/adapters/consoleBillingNotifier";
import {
    GrantCourtesyTrial,
    type RpcExecutor,
} from "@/lib/billing/use-cases/grantCourtesyTrial";

export const runtime = "nodejs";

/**
 * Executa RPC via HTTP direto (PostgREST REST endpoint).
 *
 * Por que NÃO usar `client.rpc(...)`?
 *   O @supabase/postgrest-js@2.89.0 tem um bug conhecido onde ele faz
 *   destructuring `const { ..., ...rest } = response` e quando recebe uma
 *   resposta mal-formed (ex: signature mismatch, response de erro não-Postgrest),
 *   V8 lança `TypeError: Cannot read properties of undefined (reading 'rest')`
 *   e isso vira a `error.message` que o Next retorna como 400.
 *
 *   Fazendo o fetch direto, controlamos o shape da resposta e extraímos a
 *   mensagem real do SQL/PgSQL.
 */
function makeRpc(): RpcExecutor {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
        throw new Error("Missing Supabase URL or service role key");
    }
    return async (fn, args) => {
        const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "apikey": serviceKey,
                "Authorization": `Bearer ${serviceKey}`,
            },
            body: JSON.stringify(args),
        });
        // RPCs podem retornar timestamp (string) ou json; tenta json, fallback text
        const text = await res.text();
        if (!res.ok) {
            // Mensagem de erro do PostgREST vem em `message` ou `details` ou é o próprio body
            let msg = text;
            try {
                const parsed = JSON.parse(text);
                msg = parsed.message ?? parsed.details ?? parsed.hint ?? text;
            } catch {
                // text não era JSON, usa o body cru
            }
            return { data: null, error: { message: msg || `HTTP ${res.status}` } };
        }
        // Sucesso: data é o retorno da RPC
        let data: unknown = text;
        try {
            data = JSON.parse(text);
        } catch {
            // text não era JSON (ex: timestamp string), mantém o texto cru
        }
        return { data, error: null };
    };
}

/**
 * POST /api/platform/tenants/[companyId]/courtesy-trial
 * Body: { days: number, plan_key: "essencial"|"pro"|"market", reason?: string }
 * Superadmin only — 1 a 14 dias (validado no use case).
 */
export async function POST(
    req: Request,
    ctxParams: { params: Promise<{ companyId: string }> }
) {
    console.log("[courtesy-trial] ENTRY");
    return withPlatformAccess("platform.billing.write", async (ctx) => {
        console.log("[courtesy-trial] withPlatformAccess OK, actor=", ctx.actor.role, ctx.actor.email);
        if (ctx.actor.role !== "superadmin") {
            return NextResponse.json(
                { error: "Courtesy trial requires superadmin role" },
                { status: 403 }
            );
        }

        const { companyId } = await ctxParams.params;
        console.log("[courtesy-trial] companyId=", companyId);
        const body = (await req.json().catch((err) => {
            console.error("[courtesy-trial] body parse failed:", err);
            return {};
        })) as {
            days?: number;
            plan_key?: string;
            planKey?: string;
            reason?: string;
        };
        console.log("[courtesy-trial] body=", body);

        const rpc = makeRpc();
        const notifier = new ConsoleBillingNotifier();
        const uc = new GrantCourtesyTrial(rpc, notifier);

        try {
            console.log("[courtesy-trial] calling rpc_platform_grant_courtesy_trial with", {
                companyId: companyId.trim(),
                days: Number(body.days ?? 0),
                planKey: String(body.plan_key ?? body.planKey ?? ""),
                actor: {
                    actorId: ctx.actor.id,
                    actorEmail: ctx.actor.email,
                    actorRole: ctx.actor.role,
                    requestId: ctx.requestId,
                    ipAddress: ctx.ipAddress,
                    userAgent: ctx.userAgent ?? "unknown",
                },
            });
            const result = await uc.execute({
                companyId: companyId.trim(),
                days: Number(body.days ?? 0),
                planKey: String(body.plan_key ?? body.planKey ?? "") as "essencial" | "pro" | "market",
                reason: body.reason,
                actor: {
                    actorId: ctx.actor.id,
                    actorEmail: ctx.actor.email,
                    actorRole: ctx.actor.role,
                    requestId: ctx.requestId,
                    ipAddress: ctx.ipAddress,
                    userAgent: ctx.userAgent ?? "unknown",
                },
            });
            console.log("[courtesy-trial] SUCCESS result=", result);
            return NextResponse.json({
                ok: true,
                company_id: companyId,
                trial_ends_at: result.trialEndsAt,
                days: result.days,
                plan_key: result.planKey,
            });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            const stack = e instanceof Error ? e.stack : "(no stack)";
            const name = e instanceof Error ? e.constructor.name : typeof e;
            console.error(`[courtesy-trial] FAILED name=${name} msg=${msg} stack=${stack}`);
            const status =
                msg.includes("already_paid") ||
                msg.includes("not_eligible") ||
                msg.includes("courtesy_trial_days_invalid") ||
                msg.includes("plan_key") ||
                msg.includes("plan_not_found")
                    ? 409
                    : 400;
            return NextResponse.json({ error: msg, _diag_name: name, _diag_stack: stack?.split("\n").slice(0, 3) }, { status });
        }
    });
}
