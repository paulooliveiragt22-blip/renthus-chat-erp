import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { requirePlanFeature } from "@/lib/billing/requirePlanFeature";
import { SubmitWhatsappTemplateBodySchema } from "@/src/domain/contracts/whatsappTemplates";
import { submitTemplateToMeta } from "@/lib/whatsapp-templates/submitTemplateToMeta";

export const runtime = "nodejs";

export async function POST(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const feat = await requirePlanFeature(admin, companyId, "whatsapp_templates_broadcast");
    if (!feat.ok) return feat.response;

    const raw = await req.json().catch(() => ({}));
    const parsed = SubmitWhatsappTemplateBodySchema.safeParse(raw);
    if (!parsed.success) {
        return NextResponse.json(
            { error: "validation_failed", details: parsed.error.flatten() },
            { status: 400 }
        );
    }

    const result = await submitTemplateToMeta(admin, companyId, parsed.data);
    if (!result.ok) {
        return NextResponse.json(
            { error: result.error, hint: result.hint, details: result.details },
            { status: 502 }
        );
    }

    return NextResponse.json({ template: result.template });
}
