// app/api/agent/reprint/route.ts
// POST { order_id } → insere um novo print_job com status 'pending' para reimprimir

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { enqueuePrintJob } from "@/lib/server/print/enqueuePrintJob";

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

  const queued = await enqueuePrintJob({
    admin,
    companyId: access.companyId,
    orderId: String(order_id),
    source: "reprint",
    change: typeof change === "number" ? change : Number(change ?? 0),
    priority: 5,
  });
  if (!queued.ok) return NextResponse.json({ error: queued.error }, { status: 500 });
  return NextResponse.json({ ok: true, job_id: queued.jobId });
}
