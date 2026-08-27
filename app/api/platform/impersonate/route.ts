import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { withPlatformAccess } from "@/lib/platform/apiHelpers";
import { recordPlatformAudit } from "@/lib/platform/audit/recordPlatformAudit";
import {
    PLATFORM_IMPERSONATION_COOKIE,
    PLATFORM_IMPERSONATION_TTL_MS,
    isImpersonationActive,
    type ImpersonationSessionRow,
} from "@/lib/platform/impersonation";

export const runtime = "nodejs";

/**
 * Status do banner no AdminShell (host tenant).
 * Sem cookie → 200 { active:false } (não exige sessão platform — evita 403 no console).
 * Com cookie → valida sessão via service_role.
 */
export async function GET() {
    const jar = await cookies();
    const sessionId = jar.get(PLATFORM_IMPERSONATION_COOKIE)?.value?.trim();
    if (!sessionId) {
        return NextResponse.json({ active: false });
    }

    const admin = createAdminClient();
    const { data } = await admin
        .from("platform_impersonation_sessions")
        .select("id, platform_user_id, company_id, reason, started_at, expires_at, ended_at")
        .eq("id", sessionId)
        .maybeSingle();

    const row = data as ImpersonationSessionRow | null;
    if (!isImpersonationActive(row)) {
        return NextResponse.json({ active: false });
    }

    const { data: company } = await admin
        .from("companies")
        .select("id, name")
        .eq("id", row!.company_id)
        .maybeSingle();

    return NextResponse.json({
        active: true,
        sessionId: row!.id,
        companyId: row!.company_id,
        companyName: company?.name ?? row!.company_id,
        reason: row!.reason,
        expiresAt: row!.expires_at,
    });
}

export async function POST(req: Request) {
    return withPlatformAccess("platform.impersonate", async (ctx) => {
        const body = await req.json().catch(() => ({}));
        const companyId = typeof body.company_id === "string" ? body.company_id : "";
        const reason = typeof body.reason === "string" ? body.reason.trim() : "";
        if (!companyId || reason.length < 3) {
            return NextResponse.json(
                { error: "company_id e reason (≥3 chars) obrigatórios" },
                { status: 400 }
            );
        }

        const { data: company } = await ctx.admin
            .from("companies")
            .select("id, name")
            .eq("id", companyId)
            .maybeSingle();
        if (!company) {
            return NextResponse.json({ error: "Empresa não encontrada" }, { status: 404 });
        }

        // Encerra sessão anterior do mesmo actor
        await ctx.admin
            .from("platform_impersonation_sessions")
            .update({ ended_at: new Date().toISOString() })
            .eq("platform_user_id", ctx.actor.id)
            .is("ended_at", null);

        const expiresAt = new Date(Date.now() + PLATFORM_IMPERSONATION_TTL_MS).toISOString();
        const { data: session, error } = await ctx.admin
            .from("platform_impersonation_sessions")
            .insert({
                platform_user_id: ctx.actor.id,
                company_id: companyId,
                reason,
                expires_at: expiresAt,
            })
            .select("id")
            .single();

        if (error || !session) {
            return NextResponse.json({ error: error?.message ?? "insert failed" }, { status: 500 });
        }

        await recordPlatformAudit({
            admin: ctx.admin,
            actor: ctx.actor,
            action: "platform.impersonation.started",
            resourceType: "company",
            resourceId: companyId,
            companyId,
            requestId: ctx.requestId,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            metadata: { reason, session_id: session.id },
        });

        const res = NextResponse.json({
            ok: true,
            sessionId: session.id,
            companyId,
            expiresAt,
        });

        res.cookies.set(PLATFORM_IMPERSONATION_COOKIE, session.id, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            path: "/",
            maxAge: Math.floor(PLATFORM_IMPERSONATION_TTL_MS / 1000),
        });
        res.cookies.set("renthus_company_id", companyId, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/",
            maxAge: Math.floor(PLATFORM_IMPERSONATION_TTL_MS / 1000),
        });

        return res;
    });
}

export async function DELETE() {
    return withPlatformAccess("platform.impersonate", async (ctx) => {
        const jar = await cookies();
        const sessionId = jar.get(PLATFORM_IMPERSONATION_COOKIE)?.value;

        if (sessionId) {
            const { data: row } = await ctx.admin
                .from("platform_impersonation_sessions")
                .select("id, company_id, platform_user_id, ended_at")
                .eq("id", sessionId)
                .maybeSingle();

            if (row && !row.ended_at && row.platform_user_id === ctx.actor.id) {
                await ctx.admin
                    .from("platform_impersonation_sessions")
                    .update({ ended_at: new Date().toISOString() })
                    .eq("id", sessionId);

                await recordPlatformAudit({
                    admin: ctx.admin,
                    actor: ctx.actor,
                    action: "platform.impersonation.ended",
                    resourceType: "company",
                    resourceId: row.company_id,
                    companyId: row.company_id,
                    requestId: ctx.requestId,
                    ipAddress: ctx.ipAddress,
                    userAgent: ctx.userAgent,
                    metadata: { session_id: sessionId },
                });
            }
        }

        const res = NextResponse.json({ ok: true });
        res.cookies.delete(PLATFORM_IMPERSONATION_COOKIE);
        return res;
    });
}
