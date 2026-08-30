/**
 * Contratos canônicos de invoice (fatura) — Pagar.me.
 *
 * Vem da tabela `invoices`. Os campos PIX (`pix_qr_code`, `pagarme_payment_url`)
 * ficam no shape estendido, pois pertencem ao contexto de checkout.
 */

import type { PagarmeInvoiceStatus } from "./status";

/** Invoice Pagar.me — shape canônico. */
export interface Invoice {
  id: string;
  companyId: string;
  subscriptionId: string | null;
  amount: number;
  status: PagarmeInvoiceStatus;
  dueAt: Date;
  paidAt: Date | null;
  pagarmeOrderId: string | null;
  hasPix: boolean;
  paymentUrl: string | null;
  pixQrCode: string | null;
}
