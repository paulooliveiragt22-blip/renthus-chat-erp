import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

type IbgeMunicipio = {
    id: number;
    nome: string;
    microrregiao?: {
        mesorregiao?: {
            UF?: { sigla?: string };
        };
    };
};

type IbgeDistrito = {
    nome: string;
};

function normalizeText(raw: string): string {
    return raw
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

async function fetchIbgeNeighborhoods(city: string, state: string): Promise<string[]> {
    const municipioRes = await fetch(
        `https://servicodados.ibge.gov.br/api/v1/localidades/municipios?nome=${encodeURIComponent(city)}`,
        { cache: "no-store" }
    );
    if (!municipioRes.ok) return [];
    const municipios = (await municipioRes.json().catch(() => [])) as IbgeMunicipio[];
    const target = normalizeText(city);
    const uf = state.trim().toUpperCase();
    const municipio = municipios.find((m) => {
        const sameCity = normalizeText(String(m.nome ?? "")) === target;
        const mUf = String(m.microrregiao?.mesorregiao?.UF?.sigla ?? "").toUpperCase();
        const sameUf = !uf || mUf === uf;
        return sameCity && sameUf;
    });
    if (!municipio?.id) return [];

    const distritosRes = await fetch(
        `https://servicodados.ibge.gov.br/api/v1/localidades/municipios/${municipio.id}/distritos`,
        { cache: "no-store" }
    );
    if (!distritosRes.ok) return [];
    const distritos = (await distritosRes.json().catch(() => [])) as IbgeDistrito[];
    return [...new Set(distritos.map((d) => String(d.nome ?? "").trim()).filter(Boolean))].sort();
}

export async function GET(req: NextRequest) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const admin = createAdminClient();

    const city = String(req.nextUrl.searchParams.get("city") ?? "").trim();
    const state = String(req.nextUrl.searchParams.get("state") ?? "").trim().toUpperCase();
    const refresh = req.nextUrl.searchParams.get("refresh") === "1";
    if (!city) return NextResponse.json({ neighborhoods: [], source: "none" });

    const { data: localRows } = await admin
        .from("city_neighborhoods")
        .select("neighborhood")
        .eq("city", city)
        .eq("state", state)
        .order("neighborhood");
    const local = (localRows ?? []).map((r) => String(r.neighborhood ?? "")).filter(Boolean);
    if (local.length && !refresh) {
        return NextResponse.json({ neighborhoods: local, source: "local" });
    }

    const ibge = await fetchIbgeNeighborhoods(city, state);
    if (ibge.length) {
        const payload = ibge.map((n) => ({
            city,
            state: state || null,
            neighborhood: n,
            source: "ibge",
        }));
        await admin.from("city_neighborhoods").upsert(payload, { onConflict: "city,state,neighborhood" });
        return NextResponse.json({ neighborhoods: ibge, source: "ibge" });
    }

    return NextResponse.json({ neighborhoods: local, source: local.length ? "local" : "empty" });
}
