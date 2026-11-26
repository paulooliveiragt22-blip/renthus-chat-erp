import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServiceTracePort } from "@/src/service/ports/serviceTurnPorts";

export function createServiceTrace(admin: SupabaseClient): ServiceTracePort {
    return {
        async record(event) {
            const { error } = await admin.from("pipeline_turn_traces").upsert(
                {
                    v: 1,
                    company_id: event.companyId,
                    thread_id: event.threadId,
                    channel: event.channel,
                    inbound_message_id: event.messageId,
                    state_before: { kind: "service" },
                    state_after: {
                        kind: "service",
                        tools: event.tools,
                        writes: event.writes,
                        failure: event.failure,
                    },
                    outbound: [],
                    draft_snapshot: null,
                    telemetry_reason: "service_turn",
                    ai_profile: null,
                },
                { onConflict: "company_id,inbound_message_id" }
            );
            if (error) {
                throw new Error(`service_trace:${error.message}`);
            }
        },
    };
}
