/**
 * Port — SubscriptionRepository
 *
 * Define o contrato de leitura/escrita de assinaturas Pagar.me que qualquer
 * adapter deve implementar. Puro (sem I/O real) — testável com mocks.
 *
 * Direção de dependência (Hexagonal):
 *   use-cases → ports ← adapters
 *
 * Implementações concretas (adapters) ficam em lib/billing/adapters/.
 */

import type {
  PagarmeSubscription,
  PagarmeSubscriptionWithCompany,
  PagarmeSubscriptionWithLastInvoice,
} from "../contracts/subscription";
import type { PagarmeSubStatus, SubscriptionPlanKey } from "../contracts/status";

export interface SubscriptionFilter {
  /** Filtrar por statuses (OR). Se omitido, retorna todos. */
  statuses?: readonly PagarmeSubStatus[];
  /** Filtrar por plan_key (igualdade exata). */
  planKey?: SubscriptionPlanKey;
  /** Filtrar por company_id específica. */
  companyId?: string;
  /** Paginação: offset (registro inicial, 0-based). */
  offset?: number;
  /** Paginação: limit (max de registros). */
  limit?: number;
}

export interface SubscriptionRepositoryPort {
  /**
   * Lista assinaturas com JOIN de company.
   * Usado pelo super admin UI e pelo use-case ListSubscriptionsForPlatform.
   */
  list(filter: SubscriptionFilter): Promise<PagarmeSubscriptionWithCompany[]>;

  /**
   * Lista apenas assinaturas que NUNCA pagaram (helper isNeverPaid puro).
   * Substitui a query hard-coded de platformNeverPaidTenants.
   */
  listNeverPaid(filter?: SubscriptionFilter): Promise<PagarmeSubscriptionWithCompany[]>;

  /**
   * Lista assinaturas enriquecida com a última invoice (1 round-trip via IN).
   * Retorna o shape estendido para a UI do super admin.
   */
  listWithLastInvoice(
    filter: SubscriptionFilter
  ): Promise<PagarmeSubscriptionWithLastInvoice[]>;

  /**
   * Busca subscription por id (PK).
   */
  findById(id: string): Promise<PagarmeSubscriptionWithCompany | null>;

  /**
   * Busca subscription por company_id (UNIQUE constraint).
   * Retorna null se empresa nunca teve subscription.
   */
  findByCompany(companyId: string): Promise<PagarmeSubscription | null>;
}
