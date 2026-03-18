// app/api/agent/reprint/route.ts
// POST { order_id } → insere um novo print_job com status 'pending' para reimprimir

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const access = await requireCompanyAccess();
  if (!access.ok) return new NextResponse(access.error, { status: access.status });

  const { order_id } = await req.json().catch(() => ({}));
  if (!order_id) return NextResponse.json({ error: "order_id obrigatório" }, { status: 400 });

  const admin = createAdminClient();

  // Garante que o pedido pertence a esta empresa
  const { data: order, error: ordErr } = await admin
    .from("orders")
    .select("id, company_id")
    .eq("id", order_id)
    .eq("company_id", access.companyId)
    .maybeSingle();

  if (ordErr || !order) {
    return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  }

  const { data: job, error: jobErr } = await admin
    .from("print_jobs")
    .insert([{
      company_id: access.companyId,
      order_id:   order_id,
      status:     "pending",
      attempts:   0,
      priority:   5,
      source:     "reprint",
    }])
    .select("id")
    .single();

  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, job_id: job.id });
}
