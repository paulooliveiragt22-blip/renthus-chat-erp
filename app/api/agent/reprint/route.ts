// app/api/agent/reprint/route.ts
// POST { order_id, copy_types?: string[], change? } → enfileira job(s) por via

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { requirePlanFeature } from "@/lib/billing/requirePlanFeature";
import { enqueuePrintJob } from "@/lib/server/print/enqueuePrintJob";
import { normalizePrintCopyTypes } from "@/lib/print/copyTypes";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const access = await requireCapability("print.operate");
  if (!access.ok) return new NextResponse(access.error, { status: access.status });

  const feat = await requirePlanFeature(access.admin, access.companyId, "printing_auto");
  if (!feat.ok) return feat.response;

  const body = (await req.json().catch(() => ({}))) as {
    order_id?: string;
    change?: number;
    copy_types?: unknown;
  };
  const order_id = String(body.order_id ?? "").trim();
  if (!order_id) return NextResponse.json({ error: "order_id obrigatório" }, { status: 400 });

  const copyTypes = normalizePrintCopyTypes(body.copy_types);
  // Sem seleção → só caixa (reprint legado)
  const copies = copyTypes.length > 0 ? copyTypes : (["cashier"] as const);

  const admin = createAdminClient();

  const { data: order, error: ordErr } = await admin
    .from("orders")
    .select("id, company_id, fulfillment_type")
    .eq("id", order_id)
    .eq("company_id", access.companyId)
    .maybeSingle();

  if (ordErr || !order) {
    return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  }

  const queued = await enqueuePrintJob({
    admin,
    companyId: access.companyId,
    orderId: order_id,
    source: "reprint",
    change: typeof body.change === "number" ? body.change : Number(body.change ?? 0),
    priority: 5,
    copyTypes: [...copies],
  });
  if (!queued.ok) return NextResponse.json({ error: queued.error }, { status: 500 });

  return NextResponse.json({
    ok: true,
    job_id: queued.jobId,
    jobs: queued.jobs,
    skipped: queued.skipped,
  });
}
