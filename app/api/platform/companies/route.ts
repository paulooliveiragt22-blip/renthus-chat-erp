import { NextResponse } from "next/server";
import { withPlatformAccess, toAuditCtx } from "@/lib/platform/apiHelpers";
import {
    createCompany,
    getCompanies,
    getPlans,
} from "@/lib/platform/services/platformOps";
import { parseCompaniesFilterFromSearchParams } from "@/lib/platform/companiesFilters";

export const runtime = "nodejs";

export async function GET(req: Request) {
    return withPlatformAccess("platform.companies.read", async (ctx) => {
        const url = new URL(req.url);
        const filters = parseCompaniesFilterFromSearchParams(url.searchParams);
        const page = Number(url.searchParams.get("page") ?? "0");
        const limit = Number(url.searchParams.get("limit") ?? "50");

        if (url.searchParams.get("export") === "csv") {
            const all = await getCompanies(ctx.admin, filters, {
                page: 0,
                limit: 5000,
                forExport: true,
            });
            const header = [
                "id",
                "name",
                "slug",
                "email",
                "cnpj",
                "cidade",
                "uf",
                "is_active",
                "plan",
                "sub_status",
                "onboarding_completed_at",
                "created_at",
                "order_count",
                "last_order_at",
                "channel_count",
                "active_channel_count",
            ];
            const lines = [header.join(",")];
            for (const c of all.companies) {
                const row = [
                    c.id,
                    csv(c.name),
                    csv(c.slug),
                    csv(c.email),
                    csv(c.cnpj),
                    csv(c.cidade),
                    csv(c.uf),
                    c.is_active ? "1" : "0",
                    csv(c.subscription?.plans?.name ?? ""),
                    csv(c.subscription?.status ?? ""),
                    csv(c.onboarding_completed_at),
                    csv(c.created_at),
                    String(c.orderCount),
                    csv(c.lastOrderAt),
                    String(c.channelCount),
                    String(c.activeChannelCount),
                ];
                lines.push(row.join(","));
            }
            return new NextResponse(lines.join("\n"), {
                status: 200,
                headers: {
                    "Content-Type": "text/csv; charset=utf-8",
                    "Content-Disposition":
                        'attachment; filename="empresas-platform.csv"',
                },
            });
        }

        const data = await getCompanies(ctx.admin, filters, { page, limit });
        return NextResponse.json(data);
    });
}

function csv(v: string | null | undefined): string {
    const s = v ?? "";
    if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
    return s;
}

export async function POST(req: Request) {
    return withPlatformAccess("platform.companies.write", async (ctx) => {
        const body = await req.json();
        const plans = await getPlans(ctx.admin);
        const planId = body.plan_id ?? plans[0]?.id;
        if (!body.name?.trim() || !planId) {
            return NextResponse.json(
                { error: "name and plan_id required" },
                { status: 400 }
            );
        }
        const id = await createCompany(ctx.admin, toAuditCtx(ctx), {
            name: body.name.trim(),
            email: body.email,
            slug: body.slug,
            cnpj: body.cnpj,
            phone: body.phone,
            cidade: body.cidade,
            plan_id: planId,
        });
        return NextResponse.json({ id }, { status: 201 });
    });
}
