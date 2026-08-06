import type { OutboundMessage, ProSessionState, TenantRef } from "@/src/types/contracts";
import type { LoggerPort } from "../../ports/logger.port";
import type { MessageGateway } from "../../ports/message.gateway";
import type { MetricsPort } from "../../ports/metrics.port";
import type { SessionRepository } from "../../ports/session.repository";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordPipelineTurnTrace } from "@/lib/pro/recordPipelineTurnTrace";

export async function persistAndEmit(params: {
    tenant: TenantRef;
    state: ProSessionState;
    outbound: OutboundMessage[];
    sessionRepo: SessionRepository;
    messageGateway: MessageGateway;
    metrics: MetricsPort;
    logger: LoggerPort;
    /** Fase 1 harness — gravar trace atrás de PRO_PIPELINE_TURN_TRACE. */
    turnTrace?: {
        stateBefore: ProSessionState;
        admin: SupabaseClient | null | undefined;
        aiProfile?: string | null;
        telemetryReason?: string | null;
    };
}): Promise<void> {
    const { tenant, state, outbound, sessionRepo, messageGateway, metrics, logger } = params;

    try {
        await sessionRepo.save(tenant.companyId, tenant.threadId, state);
    } catch (error) {
        metrics.increment("pro_pipeline.session_save_failed", 1, {
            companyId: tenant.companyId,
            threadId: tenant.threadId,
        });
        logger.error("pro_pipeline.session_save_failed", {
            companyId: tenant.companyId,
            threadId: tenant.threadId,
            message: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }

    for (const msg of outbound) {
        await messageGateway.send(tenant, msg);
    }

    if (params.turnTrace?.admin) {
        await recordPipelineTurnTrace({
            admin: params.turnTrace.admin,
            tenant,
            stateBefore: params.turnTrace.stateBefore,
            stateAfter: state,
            outbound,
            aiProfile: params.turnTrace.aiProfile,
            telemetryReason: params.turnTrace.telemetryReason,
        });
    }

    metrics.increment("pro_pipeline.outbound_count", outbound.length, {
        companyId: tenant.companyId,
    });

    logger.info("pro_pipeline.persist_emit.ok", {
        companyId: tenant.companyId,
        threadId: tenant.threadId,
        outboundCount: outbound.length,
        step: state.step,
    });
}
