// app/api/agent/settings/route.ts
// GET  → lê configurações de impressão da empresa (companies.settings)
// PATCH → salva configurações de impressão

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { requirePlanFeature } from "@/lib/billing/requirePlanFeature";

export const runtime = "nodejs";

export type PrintSettings = {
  print_header:           string;
  print_footer:           string;
  auto_print:             boolean;
  print_on_receive:       boolean;
  hide_prices_kitchen:    boolean;
};

const DEFAULTS: PrintSettings = {
  print_header:           "",
  print_footer:           "",
  auto_print:             false,
  print_on_receive:       true,
  hide_prices_kitchen:    false,
};

function extractSettings(raw: Record<string, unknown>): PrintSettings {
  return {
    print_header:        (raw.print_header         as string)  ?? DEFAULTS.print_header,
    print_footer:        (raw.print_footer         as string)  ?? DEFAULTS.print_footer,
    auto_print:          (raw.auto_print           as boolean) ?? DEFAULTS.auto_print,
    print_on_receive:    (raw.print_on_receive     as boolean) ?? DEFAULTS.print_on_receive,
    hide_prices_kitchen: (raw.hide_prices_kitchen  as boolean) ?? DEFAULTS.hide_prices_kitchen,
  };
}

export async function GET() {
  const access = await requireCapability("print.operate");
  if (!access.ok) return new NextResponse(access.error, { status: access.status });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("companies")
    .select("settings")
    .eq("id", access.companyId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const settings = extractSettings((data?.settings ?? {}) as Record<string, unknown>);
  return NextResponse.json({ settings });
}

export async function PATCH(req: Request) {
  const access = await requireCompanyAccess(["owner", "admin"]);
  if (!access.ok) return new NextResponse(access.error, { status: access.status });

  const feat = await requirePlanFeature(access.admin, access.companyId, "printing_auto");
  if (!feat.ok) return feat.response;

  const body = await req.json().catch(() => ({})) as Partial<PrintSettings>;

  const admin = createAdminClient();

  const { data: current } = await admin
    .from("companies")
    .select("settings")
    .eq("id", access.companyId)
    .single();

  const keys: (keyof PrintSettings)[] = [
    "print_header", "print_footer", "auto_print",
    "print_on_receive", "hide_prices_kitchen",
  ];

  const patch: Record<string, unknown> = {};
  for (const k of keys) {
    if (body[k] !== undefined) patch[k] = body[k];
  }

  const merged = { ...(current?.settings ?? {}), ...patch };

  const { error } = await admin
    .from("companies")
    .update({ settings: merged })
    .eq("id", access.companyId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, settings: extractSettings(merged) });
}
