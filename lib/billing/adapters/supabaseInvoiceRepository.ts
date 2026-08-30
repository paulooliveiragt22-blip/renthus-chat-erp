/**
 * Adapter Supabase — InvoiceRepository
 *
 * Implementa InvoiceRepositoryPort lendo da tabela invoices.
 *
 * Direção: ports ← adapters (Hexagonal).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { InvoiceRepositoryPort, InvoiceFilter } from "../ports/invoiceRepository";
import type { Invoice } from "../contracts/invoice";
import type { PagarmeInvoiceStatus } from "../contracts/status";

type InvoiceRow = {
  id: string;
  company_id: string;
  subscription_id: string | null;
  amount: number | string;
  status: PagarmeInvoiceStatus;
  due_at: string;
  paid_at: string | null;
  pagarme_order_id: string | null;
  pix_qr_code: string | null;
  pagarme_payment_url: string | null;
  created_at?: string;
};

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function rowToDomain(row: InvoiceRow): Invoice {
  const pix = typeof row.pix_qr_code === "string" ? row.pix_qr_code.trim() : "";
  return {
    id: row.id,
    companyId: row.company_id,
    subscriptionId: row.subscription_id,
    amount: Number(row.amount),
    status: row.status,
    dueAt: parseDate(row.due_at) ?? new Date(NaN),
    paidAt: parseDate(row.paid_at),
    pagarmeOrderId: row.pagarme_order_id,
    hasPix: pix.length > 0,
    paymentUrl: row.pagarme_payment_url,
    pixQrCode: row.pix_qr_code,
  };
}

export class SupabaseInvoiceRepository implements InvoiceRepositoryPort {
  constructor(private readonly admin: SupabaseClient) {}

  private baseSelect(): string {
    return [
      "id",
      "company_id",
      "subscription_id",
      "amount",
      "status",
      "due_at",
      "paid_at",
      "pagarme_order_id",
      "pix_qr_code",
      "pagarme_payment_url",
      "created_at",
    ].join(",");
  }

  async list(filter: InvoiceFilter): Promise<Invoice[]> {
    let q = this.admin.from("invoices").select(this.baseSelect());
    if (filter.companyIds?.length) q = q.in("company_id", [...filter.companyIds]);
    if (filter.status) q = q.eq("status", filter.status);
    if (filter.statuses?.length) q = q.in("status", [...filter.statuses]);
    if (filter.subscriptionId) q = q.eq("subscription_id", filter.subscriptionId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as InvoiceRow[]).map(rowToDomain);
  }

  async lastByCompany(companyIds: readonly string[]): Promise<Map<string, Invoice>> {
    if (companyIds.length === 0) return new Map();
    const { data, error } = await this.admin
      .from("invoices")
      .select(this.baseSelect())
      .in("company_id", [...companyIds])
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const result = new Map<string, Invoice>();
    for (const row of (data ?? []) as unknown as InvoiceRow[]) {
      if (!result.has(row.company_id)) {
        result.set(row.company_id, rowToDomain(row));
      }
    }
    return result;
  }

  async findById(id: string): Promise<Invoice | null> {
    const { data, error } = await this.admin
      .from("invoices")
      .select(this.baseSelect())
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToDomain(data as unknown as InvoiceRow) : null;
  }
}
