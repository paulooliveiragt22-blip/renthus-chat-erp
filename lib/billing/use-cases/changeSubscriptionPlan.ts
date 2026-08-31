/**
 * Use Case — ChangeSubscriptionPlan
 *
 * Muda o plano de uma subscription. Persiste via RPC
 * rpc_platform_change_subscription_plan (validação e audit no banco).
 */

import type { BillingNotifierPort } from "../ports/billingNotifier";
import type { SubscriptionPlanKey } from "../contracts/status";
import type { ActorContext } from "./actorContext";

export interface ChangeSubscriptionPlanInput {
  subscriptionId: string;
  planKey: SubscriptionPlanKey;
  reason?: string;
  actor: ActorContext;
}

export type RpcExecutor = (
  fn: string,
  args: Record<string, unknown>
) => Promise<{ data: unknown; error: { message: string } | null }>;

export class ChangeSubscriptionPlan {
  constructor(
    private readonly rpc: RpcExecutor,
    private readonly notifier: BillingNotifierPort
  ) {}

  async execute(input: ChangeSubscriptionPlanInput): Promise<void> {
    if (!input.subscriptionId) throw new Error("subscriptionId required");
    if (!input.planKey) throw new Error("planKey required");

    const { error } = await this.rpc("rpc_platform_change_subscription_plan", {
      p_subscription_id: input.subscriptionId,
      p_plan_key: input.planKey,
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
      kind: "subscription_plan_changed",
      scope: "platform-billing",
      message: `plan changed to ${input.planKey}`,
      subscriptionId: input.subscriptionId,
      extra: { planKey: input.planKey, reason: input.reason ?? "" },
      occurredAt: new Date(),
    });
  }
}
