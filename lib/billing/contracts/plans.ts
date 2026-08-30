/**
 * Contratos canônicos de Plan — espelha a tabela `plans`.
 *
 * O `key` (string) é o identificador canônico (ex.: "essencial", "pro", "market").
 * O `id` (uuid) é o identificador físico usado em FKs.
 */

import type { SubscriptionPlanKey } from "./status";

export interface PlanInfo {
  id: string;
  key: SubscriptionPlanKey;
  name: string;
  description: string | null;
  priceCents: number;
  createdAt: Date;
}

/** Plan resumido (sem preço/descrição) — para joins em listagens. */
export interface PlanRef {
  id: string;
  key: SubscriptionPlanKey;
  name: string;
}
