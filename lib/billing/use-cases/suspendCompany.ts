/**
 * Use Case — SuspendCompany
 *
 * Suspende empresa:
 *  1. Persiste via RPC rpc_platform_suspend_company (que propaga status blocked
 *     em pagarme_subscriptions e desativa canais WhatsApp)
 *  2. Notifica evento de auditoria
 */

import type { BillingNotifierPort } from "../ports/billingNotifier";
import type { ActorContext } from "./actorContext";

export interface SuspendCompanyInput {
  companyId: string;
  reason?: string;
  actor: ActorContext;
}

export type RpcExecutor = (
  fn: string,
  args: Record<string, unknown>
) => Promise<{ data: unknown; error: { message: string } | null }>;

export class SuspendCompany {
  constructor(
    private readonly rpc: RpcExecutor,
    private readonly notifier: BillingNotifierPort
  ) {}

  async execute(input: SuspendCompanyInput): Promise<void> {
    if (!input.companyId) throw new Error("companyId required");

    const { error } = await this.rpc("rpc_platform_suspend_company", {
      p_company_id: input.companyId,
      p_actor_id: input.actor.actorId,
      p_actor_email: input.actor.actorEmail,
      p_actor_role: input.actor.actorRole,
      p_request_id: input.actor.requestId,
      p_ip_address: input.actor.ipAddress,
      p_user_agent: input.actor.userAgent,
      p_reason: input.reason ?? "",
    });

    if (error) throw new Error(error.message);

    await this.notifier.publish({
      kind: "company_suspended",
      scope: "platform-billing",
      message: "company suspended",
      companyId: input.companyId,
      extra: { reason: input.reason ?? "" },
      occurredAt: new Date(),
    });
  }
}
