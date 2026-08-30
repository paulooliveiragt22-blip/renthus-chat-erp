/**
 * Port — InvoiceRepository
 *
 * Define o contrato de leitura/escrita de faturas. Puro (sem I/O real).
 *
 * Direção de dependência (Hexagonal):
 *   use-cases → ports ← adapters
 */

import type { Invoice } from "../contracts/invoice";
import type { PagarmeInvoiceStatus } from "../contracts/status";

export interface InvoiceFilter {
  companyIds?: readonly string[];
  status?: PagarmeInvoiceStatus;
  statuses?: readonly PagarmeInvoiceStatus[];
  subscriptionId?: string;
}

export interface InvoiceRepositoryPort {
  /**
   * Lista invoices aplicando filtro.
   * Usado pelo use-case ListSubscriptionsForPlatform para enriquecer subscriptions
   * com a última fatura.
   */
  list(filter: InvoiceFilter): Promise<Invoice[]>;

  /**
   * Retorna a última invoice (created_at DESC) por empresa, em formato Map
   * para enriquecimento em batch.
   * Se uma empresa não tem invoice, não aparece no Map.
   */
  lastByCompany(companyIds: readonly string[]): Promise<Map<string, Invoice>>;

  /**
   * Busca invoice por id.
   */
  findById(id: string): Promise<Invoice | null>;
}
