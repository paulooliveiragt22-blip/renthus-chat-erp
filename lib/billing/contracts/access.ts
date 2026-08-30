/**
 * Contratos canônicos de acesso (paywall / tenant access).
 *
 * Re-exporta os tipos já existentes em `lib/billing/resolveBillingAccess.ts`
 * e `lib/billing/tenantAccess.ts`, que permanecem no mesmo path por
 * compatibilidade (migração em PRs futuros).
 *
 * Quando outros módulos precisarem do contrato, importar daqui:
 *   import type { BillingAccessStatus, TenantAccess } from "@/lib/billing/contracts/access";
 */

export type {
  BillingAccessStatus,
  BillingGateMode,
  PagarmeSubSnapshot,
} from "@/lib/billing/resolveBillingAccess";

export type {
  BillingGateOk,
  BillingGateDenied,
  BillingGateResult,
} from "@/lib/billing/requireBillingActive";

export type {
  TenantAccess,
  TenantAccessDecision,
} from "@/lib/billing/tenantAccess";
