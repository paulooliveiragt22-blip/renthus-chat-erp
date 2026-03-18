// app/api/companies/update/route.ts
// PATCH → atualiza dados públicos da empresa (nome, endereço, delivery, pagamentos)
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

const ALLOWED_FIELDS = [
  "nome_fantasia","razao_social","cnpj","phone","email",
  "whatsapp_phone","cep","endereco","numero","bairro","cidade","uf",
  "delivery_fee_enabled","default_delivery_fee","settings",
] as const;

export async function PATCH(req: Request) {
  const access = await requireCompanyAccess();
  if (!access.ok) return new NextResponse(access.error, { status: access.status });

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  for (const key of ALLOWED_FIELDS) {
    if (key in body) patch[key] = body[key];
  }

  if (Object.keys(patch).length === 0)
    return NextResponse.json({ error: "Nenhum campo para atualizar" }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin
    .from("companies")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", access.companyId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const access = await requireCompanyAccess();
  if (!access.ok) return new NextResponse(access.error, { status: access.status });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("companies")
    .select("id,nome_fantasia,razao_social,cnpj,phone,email,whatsapp_phone,cep,endereco,numero,bairro,cidade,uf,delivery_fee_enabled,default_delivery_fee,settings")
    .eq("id", access.companyId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ company: data });
}
