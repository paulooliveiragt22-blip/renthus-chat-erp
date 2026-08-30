/**
 * Adapter Console — BillingNotifier
 *
 * Implementa BillingNotifierPort usando console.log estruturado.
 * Em produção, este adapter poderia ser substituído por um que envia
 * para Sentry/Datadog/etc sem mudar nenhum use-case.
 *
 * Direção: ports ← adapters (Hexagonal).
 */

import "server-only";

import type {
  BillingNotifierPort,
  BillingEvent,
} from "../ports/billingNotifier";

export class ConsoleBillingNotifier implements BillingNotifierPort {
  async publish(event: BillingEvent): Promise<void> {
    const payload: Record<string, unknown> = {
      kind: event.kind,
      scope: event.scope,
      message: event.message,
      occurredAt: event.occurredAt.toISOString(),
    };
    if (event.companyId) payload.companyId = event.companyId;
    if (event.subscriptionId) payload.subscriptionId = event.subscriptionId;
    if (event.extra) Object.assign(payload, event.extra);

    // Formato: [billing:<scope>] <message> {json}
    // Mantém paridade com o billingLog atual pra não quebrar dashboards/APMs.
    console.log(`[billing:${event.scope}] ${event.message} ${JSON.stringify(payload)}`);
  }
}

/** Singleton para uso direto em use-cases. */
export const consoleBillingNotifier = new ConsoleBillingNotifier();
