import type { OutboundMessage, ProSessionState, TenantRef } from "@/src/types/contracts";
import type { LoggerPort } from "../../ports/logger.port";
import type { MessageGateway } from "../../ports/message.gateway";
import type { MetricsPort } from "../../ports/metrics.port";
import type { SessionRepository } from "../../ports/session.repository";

export async function persistAndEmit(params: {
    tenant: TenantRef;
    state: ProSessionState;
    outbound: OutboundMessage[];
    sessionRepo: SessionRepository;
    messageGateway: MessageGateway;
    metrics: MetricsPort;
    logger: LoggerPort;
}): Promise<void> {
    const { tenant, state, outbound, sessionRepo, messageGateway, metrics, logger } = params;

    await sessionRepo.save(tenant.companyId, tenant.threadId, state);

    for (const msg of outbound) {
        await messageGateway.send(tenant, msg);
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

