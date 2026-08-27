import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
    buildCampaignAudience,
    filterMarketingOptInAudience,
    type AudienceFilter,
} from "@/lib/campaigns/buildAudience";
import { scheduleOutboundWorkerWake } from "@/lib/chatbot/outbound/outboundWorkerWake";
import type { OutboundJobPayload } from "@/lib/chatbot/outbound/types";

async function getOrCreateThread(
    admin: SupabaseClient,
    companyId: string,
    channelId: string,
    phoneE164: string
): Promise<string> {
    const { data: existing } = await admin
        .from("whatsapp_threads")
        .select("id")
        .eq("company_id", companyId)
        .eq("phone_e164", phoneE164)
        .maybeSingle();
    if (existing?.id) return existing.id as string;

    const { data: created, error } = await admin
        .from("whatsapp_threads")
        .insert({
            company_id: companyId,
            channel_id: channelId,
            phone_e164: phoneE164,
            channel: "whatsapp",
            external_id: phoneE164,
            last_message_at: new Date().toISOString(),
        })
        .select("id")
        .single();
    if (error || !created?.id) throw new Error(error?.message ?? "thread_create_failed");
    return created.id as string;
}

export async function startBroadcastCampaign(params: {
    admin: SupabaseClient;
    companyId: string;
    userId: string;
    name: string;
    templateId: string;
    audience: AudienceFilter;
    bodyParams?: string[];
}): Promise<
    | { ok: true; campaignId: string; queued: number }
    | { ok: false; error: string; hint?: string }
> {
    const { data: template, error: tplErr } = await params.admin
        .from("whatsapp_message_templates")
        .select("id, name, language, category, status")
        .eq("id", params.templateId)
        .eq("company_id", params.companyId)
        .maybeSingle();

    if (tplErr || !template) return { ok: false, error: "template_not_found" };
    if (template.status !== "APPROVED") {
        return {
            ok: false,
            error: "template_not_approved",
            hint: "Só templates APPROVED podem ser usados em campanha.",
        };
    }

    const { data: channel } = await params.admin
        .from("whatsapp_channels")
        .select("id")
        .eq("company_id", params.companyId)
        .eq("provider", "meta")
        .eq("status", "active")
        .maybeSingle();
    if (!channel?.id) {
        return { ok: false, error: "no_active_channel", hint: "Conecte o WhatsApp em Canais." };
    }

    let audience = await buildCampaignAudience(
        params.admin,
        params.companyId,
        params.audience
    );
    if (template.category === "MARKETING") {
        audience = await filterMarketingOptInAudience(
            params.admin,
            params.companyId,
            audience
        );
        if (audience.length === 0) {
            return {
                ok: false,
                error: "no_opt_in_audience",
                hint: "Nenhum cliente com opt-in marketing (QUERO OFERTAS).",
            };
        }
    }
    if (audience.length === 0) {
        return { ok: false, error: "empty_audience", hint: "Nenhum destinatário encontrado." };
    }

    const now = new Date().toISOString();
    const bodyParams = (params.bodyParams ?? []).map((p) => String(p));

    const { data: campaign, error: campErr } = await params.admin
        .from("broadcast_campaigns")
        .insert({
            company_id: params.companyId,
            template_id: template.id,
            name: params.name.trim() || template.name,
            status: "running",
            audience_filter: params.audience,
            template_body_params: bodyParams,
            total_recipients: audience.length,
            created_by: params.userId,
            started_at: now,
            updated_at: now,
        })
        .select("id")
        .single();

    if (campErr || !campaign?.id) {
        return { ok: false, error: campErr?.message ?? "campaign_create_failed" };
    }

    const campaignId = campaign.id as string;
    let queued = 0;

    for (const member of audience) {
        const threadId = await getOrCreateThread(
            params.admin,
            params.companyId,
            channel.id as string,
            member.phoneE164
        );

        const { data: recipient, error: recErr } = await params.admin
            .from("broadcast_campaign_recipients")
            .insert({
                campaign_id: campaignId,
                company_id: params.companyId,
                customer_id: member.customerId,
                phone_e164: member.phoneE164,
                thread_id: threadId,
                status: "queued",
            })
            .select("id")
            .single();

        if (recErr || !recipient?.id) continue;

        const payload: OutboundJobPayload = {
            kind: "template",
            text: `[campanha:${params.name}] ${template.name}`,
            templateName: String(template.name),
            language: String(template.language),
            bodyParams: bodyParams.length ? bodyParams : undefined,
            campaignId,
            recipientId: recipient.id as string,
        };

        const dedupKey = `broadcast:${campaignId}:${member.phoneE164}`;
        const { data: job, error: jobErr } = await params.admin
            .from("outbound_jobs")
            .insert({
                company_id: params.companyId,
                thread_id: threadId,
                phone_e164: member.phoneE164,
                purpose: "broadcast_template",
                payload,
                dedup_key: dedupKey,
                source_id: recipient.id,
                status: "pending",
                scheduled_at: now,
            })
            .select("id")
            .single();

        if (jobErr || !job?.id) {
            await params.admin
                .from("broadcast_campaign_recipients")
                .update({
                    status: "failed",
                    error: jobErr?.message ?? "enqueue_failed",
                })
                .eq("id", recipient.id);
            continue;
        }

        await params.admin
            .from("broadcast_campaign_recipients")
            .update({ outbound_job_id: job.id })
            .eq("id", recipient.id);

        queued += 1;
    }

    await params.admin
        .from("broadcast_campaigns")
        .update({
            total_recipients: queued,
            updated_at: new Date().toISOString(),
            ...(queued === 0
                ? { status: "done", finished_at: new Date().toISOString() }
                : {}),
        })
        .eq("id", campaignId);

    scheduleOutboundWorkerWake("broadcast_campaign_start");

    return { ok: true, campaignId, queued };
}

export async function cancelBroadcastCampaign(params: {
    admin: SupabaseClient;
    companyId: string;
    campaignId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
    const { data: campaign } = await params.admin
        .from("broadcast_campaigns")
        .select("id, status")
        .eq("id", params.campaignId)
        .eq("company_id", params.companyId)
        .maybeSingle();

    if (!campaign) return { ok: false, error: "not_found" };
    if (campaign.status !== "running" && campaign.status !== "paused") {
        return { ok: false, error: "not_cancellable" };
    }

    const now = new Date().toISOString();
    await params.admin
        .from("broadcast_campaigns")
        .update({ status: "cancelled", finished_at: now, updated_at: now })
        .eq("id", params.campaignId);

    const { data: pendingRecipients } = await params.admin
        .from("broadcast_campaign_recipients")
        .select("id, outbound_job_id")
        .eq("campaign_id", params.campaignId)
        .in("status", ["pending", "queued"]);

    const jobIds = (pendingRecipients ?? [])
        .map((r) => r.outbound_job_id)
        .filter(Boolean) as string[];

    if (jobIds.length > 0) {
        await params.admin
            .from("outbound_jobs")
            .update({ status: "skipped", skip_reason: "campaign_cancelled" })
            .in("id", jobIds)
            .eq("status", "pending");
    }

    await params.admin
        .from("broadcast_campaign_recipients")
        .update({ status: "cancelled", updated_at: now })
        .eq("campaign_id", params.campaignId)
        .in("status", ["pending", "queued"]);

    return { ok: true };
}

export async function markRecipientFromOutboundJob(params: {
    admin: SupabaseClient;
    recipientId: string | null | undefined;
    campaignId: string | null | undefined;
    outcome: "sent" | "failed" | "skipped";
    error?: string;
}): Promise<void> {
    if (!params.recipientId) return;
    const now = new Date().toISOString();
    await params.admin
        .from("broadcast_campaign_recipients")
        .update({
            status: params.outcome,
            error: params.error?.slice(0, 500) ?? null,
            updated_at: now,
        })
        .eq("id", params.recipientId);

    if (!params.campaignId) return;

    const field =
        params.outcome === "sent"
            ? "sent_count"
            : params.outcome === "failed"
              ? "failed_count"
              : "skipped_count";

    const { data: camp } = await params.admin
        .from("broadcast_campaigns")
        .select("id, total_recipients, sent_count, failed_count, skipped_count, status")
        .eq("id", params.campaignId)
        .maybeSingle();
    if (!camp || camp.status === "cancelled") return;

    const next = {
        sent_count: Number(camp.sent_count ?? 0),
        failed_count: Number(camp.failed_count ?? 0),
        skipped_count: Number(camp.skipped_count ?? 0),
    };
    next[field] = next[field] + 1;

    const done =
        next.sent_count + next.failed_count + next.skipped_count >=
        Number(camp.total_recipients ?? 0);

    await params.admin
        .from("broadcast_campaigns")
        .update({
            ...next,
            updated_at: now,
            ...(done ? { status: "done", finished_at: now } : {}),
        })
        .eq("id", params.campaignId);
}
