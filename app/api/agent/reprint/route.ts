// app/api/agent/reprint/route.ts
// POST { order_id } → insere um novo print_job com status 'pending' para reimprimir

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const access = await requireCompanyAccess();
  if (!access.ok) return new NextResponse(access.error, { status: access.status });

  const { order_id, change } = await req.json().catch(() => ({}));
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

  // Busca impressora padrão da empresa (company_printers.is_default) ou a primeira com auto_print
  let printerId: string | null = null;
  const { data: cpRow } = await admin
    .from("company_printers")
    .select("printer_id")
    .eq("company_id", access.companyId)
    .eq("is_default", true)
    .maybeSingle();
  if (cpRow?.printer_id) {
    printerId = cpRow.printer_id;
  } else {
    const { data: pRow } = await admin
      .from("printers")
      .select("id")
      .eq("company_id", access.companyId)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (pRow?.id) printerId = pRow.id;
  }

  if (!printerId) {
    return NextResponse.json({ error: "Nenhuma impressora ativa configurada para esta empresa" }, { status: 400 });
  }

  const { data: job, error: jobErr } = await admin
    .from("print_jobs")
    .insert([{
      company_id: access.companyId,
      order_id:   order_id,
      source_id:  order_id,
      printer_id: printerId,
      payload:    { type: "receipt", orderId: order_id, change: change ?? 0 },
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
