import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { parseMenuSlug, slugFromDisplayName } from "@/lib/public-menu/slug";
import type { MenuProfileAdmin, MenuProfileUpsertInput } from "@/src/types/contracts.public-menu";

export const runtime = "nodejs";

function mapProfile(row: Record<string, unknown>, companyId: string): MenuProfileAdmin {
    const slugParsed = parseMenuSlug(String(row.slug ?? ""));
    return {
        companyId,
        slug: slugParsed.ok ? slugParsed.slug : (slugFromDisplayName(String(row.display_name ?? "loja")) as MenuProfileAdmin["slug"]),
        displayName: String(row.display_name ?? "Cardápio"),
        tagline: row.tagline == null ? null : String(row.tagline),
        logoUrl: row.logo_url == null ? null : String(row.logo_url),
        whatsappPhone: row.whatsapp_phone == null ? null : String(row.whatsapp_phone),
        isActive: Boolean(row.is_active),
        updatedAt: String(row.updated_at ?? new Date().toISOString()),
    };
}

export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const { data, error } = await admin
        .from("company_menu_profile")
        .select("company_id, slug, display_name, tagline, logo_url, whatsapp_phone, is_active, updated_at")
        .eq("company_id", companyId)
        .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ profile: null });
    return NextResponse.json({ profile: mapProfile(data as Record<string, unknown>, companyId) });
}

export async function PATCH(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as Partial<MenuProfileUpsertInput>;
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
    if (!displayName) {
        return NextResponse.json({ error: "display_name_required" }, { status: 400 });
    }

    const slugRaw = typeof body.slug === "string" && body.slug.trim()
        ? body.slug
        : slugFromDisplayName(displayName);
    const slugParsed = parseMenuSlug(slugRaw);
    if (!slugParsed.ok) {
        return NextResponse.json({ error: slugParsed.error }, { status: 400 });
    }

    const patch = {
        company_id: companyId,
        slug: slugParsed.slug,
        display_name: displayName.slice(0, 120),
        tagline: body.tagline == null ? null : String(body.tagline).trim().slice(0, 200) || null,
        logo_url: body.logoUrl == null ? null : String(body.logoUrl).trim().slice(0, 500) || null,
        whatsapp_phone: body.whatsappPhone == null
            ? null
            : String(body.whatsappPhone).trim().slice(0, 32) || null,
        is_active: body.isActive == null ? false : Boolean(body.isActive),
        updated_at: new Date().toISOString(),
    };

    const { data, error } = await admin
        .from("company_menu_profile")
        .upsert(patch, { onConflict: "company_id" })
        .select("company_id, slug, display_name, tagline, logo_url, whatsapp_phone, is_active, updated_at")
        .single();

    if (error) {
        if (error.code === "23505") {
            return NextResponse.json({ error: "slug_taken" }, { status: 409 });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
        ok: true,
        profile: mapProfile(data as Record<string, unknown>, companyId),
        publicPath: `/c/${slugParsed.slug}`,
    });
}
