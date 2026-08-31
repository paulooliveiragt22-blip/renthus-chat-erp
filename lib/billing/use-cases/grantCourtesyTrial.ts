/**
 * Use Case — GrantCourtesyTrial
 *
 * Concede trial cortesia para uma empresa. Validações de negócio:
 *  - days: 1..14
 *  - planKey: essencial | pro | market
 *  - companyId: obrigatório
 *
 * Persiste via RPC rpc_platform_grant_courtesy_trial (validação de owner no banco).
 */

import type { BillingNotifierPort } from "../ports/billingNotifier";
import type { SubscriptionPlanKey } from "../contracts/status";
import type { ActorContext } from "./actorContext";

export type CourtesyPlanKey = Extract<SubscriptionPlanKey, "essencial" | "pro" | "market">;

export interface GrantCourtesyTrialInput {
  companyId: string;
  days: number;
  planKey: CourtesyPlanKey;
  reason?: string;
  actor: ActorContext;
}

export interface GrantCourtesyTrialResult {
  trialEndsAt: Date;
  days: number;
  planKey: CourtesyPlanKey;
}

export type RpcExecutor = (
  fn: string,
  args: Record<string, unknown>
) => Promise<{ data: unknown; error: { message: string } | null }>;

export class GrantCourtesyTrial {
  constructor(
    private readonly rpc: RpcExecutor,
    private readonly notifier: BillingNotifierPort
  ) {}

  async execute(input: GrantCourtesyTrialInput): Promise<GrantCourtesyTrialResult> {
    if (!input.companyId) throw new Error("companyId required");
    if (!Number.isFinite(input.days) || input.days < 1 || input.days > 14) {
      throw new Error("courtesy_trial_days_invalid");
    }

    const { data, error } = await this.rpc("rpc_platform_grant_courtesy_trial", {
      p_company_id: input.companyId,
      p_days: input.days,
      p_actor_id: input.actor.actorId,
      p_actor_email: input.actor.actorEmail,
      p_actor_role: input.actor.actorRole,
      p_request_id: input.actor.requestId,
      p_ip_address: input.actor.ipAddress,
      p_user_agent: input.actor.userAgent,
      p_reason: input.reason ?? "",
    });

    if (error) throw new Error(error.message);
    if (!data) throw new Error("courtesy_trial_failed");

    const trialEndsAt = new Date(data as string);

    await this.notifier.publish({
      kind: "courtesy_trial_granted",
      scope: "platform-billing",
      message: `courtesy trial granted for ${input.days} days`,
      companyId: input.companyId,
      extra: { days: input.days, planKey: input.planKey, reason: input.reason ?? "" },
      occurredAt: new Date(),
    });

    return {
      trialEndsAt,
      days: input.days,
      planKey: input.planKey,
    };
  }
}
