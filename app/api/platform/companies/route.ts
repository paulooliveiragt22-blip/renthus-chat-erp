import { NextResponse } from "next/server";
import { withPlatformAccess, toAuditCtx } from "@/lib/platform/apiHelpers";
import {
    createCompany,
    getCompanies,
    getPlans,
} from "@/lib/platform/services/platformOps";

export const runtime = "nodejs";

export async function GET() {
    return withPlatformAccess("platform.companies.read", async (ctx) => {
        const companies = await getCompanies(ctx.admin);
        return NextResponse.json({ companies });
    });
}

export async function POST(req: Request) {
    return withPlatformAccess("platform.companies.write", async (ctx) => {
        const body = await req.json();
        const plans = await getPlans(ctx.admin);
        const planId = body.plan_id ?? plans[0]?.id;
        if (!body.name?.trim() || !planId) {
            return NextResponse.json({ error: "name and plan_id required" }, { status: 400 });
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
