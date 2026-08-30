/**
 * Adapter Supabase — SubscriptionRepository
 * Implementa SubscriptionRepositoryPort lendo de pagarme_subscriptions.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  SubscriptionRepositoryPort,
  SubscriptionFilter,
} from "../ports/subscriptionRepository";
import type {
  PagarmeSubscription,
  PagarmeSubscriptionWithCompany,
  PagarmeSubscriptionWithLastInvoice,
} from "../contracts/subscription";
import type { PagarmeSubStatus, PagarmeInvoiceStatus, SubscriptionPlanKey } from "../contracts/status";

type CompanyEmbed = {
  name: string | null;
  slug: string | null;
  is_active: boolean | null;
};

type SubRow = {
  id: string;
  company_id: string;
  plan_key: string | null;
  plan_id: string | null;
  status: PagarmeSubStatus;
  allow_overage: boolean;
  trial_ends_at: string | null;
  last_paid_at: string | null;
  next_billing_at: string | null;
  activated_at: string | null;
  started_at: string | null;
  companies: CompanyEmbed | CompanyEmbed[] | null;
};

type InvoiceRow = {
  id: string;
  company_id: string;
  amount: number | string;
  status: PagarmeInvoiceStatus;
  due_at: string;
  paid_at: string | null;
  created_at: string;
};

function pickCompany(emb: SubRow["companies"]): CompanyEmbed | null {
  if (!emb) return null;
  if (Array.isArray(emb)) return emb[0] ?? null;
  return emb;
}

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function rowToDomain(row: SubRow): PagarmeSubscription {
  return {
    id: row.id,
    companyId: row.company_id,
    planKey: (row.plan_key as SubscriptionPlanKey | null) ?? null,
    planId: row.plan_id,
    status: row.status,
    allowOverage: row.allow_overage,
    trialEndsAt: parseDate(row.trial_ends_at),
    lastPaidAt: parseDate(row.last_paid_at),
    nextBillingAt: parseDate(row.next_billing_at),
    activatedAt: parseDate(row.activated_at),
    startedAt: parseDate(row.started_at),
  };
}

export class SupabaseSubscriptionRepository implements SubscriptionRepositoryPort {
  constructor(private readonly admin: SupabaseClient) {}

  private baseSelect(): string {
    return [
      "id",
      "company_id",
      "plan_key",
      "plan_id",
      "status",
      "allow_overage",
      "trial_ends_at",
      "last_paid_at",
      "next_billing_at",
      "activated_at",
      "started_at",
      "companies (name, slug, is_active)",
    ].join(",");
  }

  async list(filter: SubscriptionFilter): Promise<PagarmeSubscriptionWithCompany[]> {
    let q = this.admin
      .from("pagarme_subscriptions")
      .select(this.baseSelect())
      .order("started_at", { ascending: false, nullsFirst: false });
    if (filter.statuses?.length) q = q.in("status", [...filter.statuses]);
    if (filter.planKey) q = q.eq("plan_key", filter.planKey);
    if (filter.companyId) q = q.eq("company_id", filter.companyId);
    if (filter.offset) q = q.range(filter.offset, filter.offset + (filter.limit ?? 100) - 1);
    else if (filter.limit) q = q.limit(filter.limit);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return ((data ?? []) as SubRow[]).map(rowToDomainWithCompany);
  }

  async listNeverPaid(): Promise<PagarmeSubscriptionWithCompany[]> {
    const { isNeverPaid } = await import("../contracts/status");
    const { data, error } = await this.admin
      .from("pagarme_subscriptions")
      .select(this.baseSelect())
      .order("started_at", { ascending: false, nullsFirst: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as SubRow[])
      .filter((row) =>
        isNeverPaid({
          status: row.status,
          last_paid_at: row.last_paid_at,
          trial_ends_at: row.trial_ends_at,
        })
      )
      .map(rowToDomainWithCompany);
  }

  async listWithLastInvoice(
    filter: SubscriptionFilter
  ): Promise<PagarmeSubscriptionWithLastInvoice[]> {
    const subs = await this.list(filter);
    if (subs.length === 0) return [];
    const companyIds = subs.map((s) => s.companyId);

    const { data: invoices, error: invErr } = await this.admin
      .from("invoices")
      .select("id, company_id, amount, status, due_at, paid_at, created_at")
      .in("company_id", companyIds)
      .order("created_at", { ascending: false });
    if (invErr) throw new Error(invErr.message);

    const lastByCompany = new Map<string, InvoiceRow>();
    for (const row of (invoices ?? []) as InvoiceRow[]) {
      if (!lastByCompany.has(row.company_id)) {
        lastByCompany.set(row.company_id, row);
      }
    }

    return subs.map((s) => {
      const inv = lastByCompany.get(s.companyId);
      return {
        ...s,
        lastInvoiceId: inv?.id ?? null,
        lastInvoiceAmount: inv ? Number(inv.amount) : null,
        lastInvoiceStatus: inv?.status ?? null,
        lastInvoiceDueAt: parseDate(inv?.due_at ?? null),
        lastInvoicePaidAt: parseDate(inv?.paid_at ?? null),
      };
    });
  }

  async findById(id: string): Promise<PagarmeSubscriptionWithCompany | null> {
    const { data, error } = await this.admin
      .from("pagarme_subscriptions")
      .select(this.baseSelect())
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToDomainWithCompany(data as SubRow) : null;
  }

  async findByCompany(companyId: string): Promise<PagarmeSubscription | null> {
    const { data, error } = await this.admin
      .from("pagarme_subscriptions")
      .select(
        "id, company_id, plan_key, plan_id, status, allow_overage, trial_ends_at, last_paid_at, next_billing_at, activated_at, started_at"
      )
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToDomain(data as SubRow) : null;
  }
}
function rowToDomainWithCompany(row: SubRow): PagarmeSubscriptionWithCompany {
  const base = rowToDomain(row);
  const c = pickCompany(row.companies);
  return {
    ...base,
    companyName: c?.name ?? "(sem nome)",
    companySlug: c?.slug ?? null,
    companyIsActive: c?.is_active ?? false,
  };
}
