/**
 * Contexto de auditoria — repassado às RPCs do projeto
 * (rpc_platform_grant_courtesy_trial, rpc_platform_change_subscription_plan,
 * rpc_platform_suspend_company) que gravam quem/quando/onde.
 *
 * Mapeado 1:1 nos parâmetros p_actor_* / p_request_id / p_ip_address /
 * p_user_agent que as RPCs exigem.
 */
export interface ActorContext {
  actorId: string;
  actorEmail: string;
  actorRole: string;
  requestId: string;
  ipAddress: string;
  userAgent: string;
}
