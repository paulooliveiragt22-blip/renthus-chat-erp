import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessagingChannel } from "@/src/domain/contracts/identity";
import type { PublicMenuSessionOk } from "@/src/types/contracts.public-menu";
import { normalizeBrMobilePhone } from "./phone";
import {
    linkWebMenuCustomerPhone,
    resolveWebMenuCustomer,
    resolveWebMenuCustomerByChannelIdentity,
} from "./resolveWebCustomer";
import { resolveChannelDisplayNameForMenu } from "./channelThreadProfile";
import { pickCustomerNameAfterPhoneLink } from "./customerNameAfterPhoneLink";
import { isGenericCustomerDisplayName } from "@/lib/meta/customerDisplayName";
import { listCustomerAddressesForMenu } from "./checkout/addresses";
import {
    signWebMenuCheckoutSession,
    verifyWebMenuLinkToken,
    type WebMenuLinkPayloadV2,
} from "./sessionToken";

export type EstablishMenuSessionInput = {
    companyId: string;
    slug: string;
    wmToken: string;
    phone?: string;
    name?: string | null;
};

export type EstablishMenuSessionResult =
    | { ok: true; data: PublicMenuSessionOk }
    | { ok: false; error: string; status: number };

/**
 * Troca link assinado `wm` (v1/v2) por sessão de checkout.
 * Telefone só é aceito junto com `wmToken` quando o canal exige (`needsPhone` IG/Messenger).
 */
export async function establishMenuSessionFromWmToken(
    admin: SupabaseClient,
    input: EstablishMenuSessionInput
): Promise<EstablishMenuSessionResult> {
    const wmToken = input.wmToken.trim();
    if (!wmToken) {
        return { ok: false, error: "token_required", status: 400 };
    }

    const link = verifyWebMenuLinkToken(wmToken);
    if (!link || link.companyId !== input.companyId || link.slug !== input.slug) {
        return { ok: false, error: "token_invalid", status: 401 };
    }

    const name: string | null = typeof input.name === "string" ? input.name.trim() : null;
    const effectiveName =
        name && !isGenericCustomerDisplayName(name) ? name : null;
    const phoneBody = typeof input.phone === "string" ? input.phone : "";

    let customer: Awaited<ReturnType<typeof resolveWebMenuCustomer>> = null;
    let channel: WebMenuLinkPayloadV2["channel"] | undefined;
    let externalId: string | undefined;

    let matchedExistingCustomer = false;

    if (link.v === 1) {
        customer = await resolveWebMenuCustomer(admin, input.companyId, link.phoneE164, name);
        channel = "whatsapp";
        externalId = link.phoneE164;
    } else {
        channel = link.channel;
        externalId = link.externalId;
        const displayName = await resolveChannelDisplayNameForMenu(
            admin,
            input.companyId,
            link.channel,
            link.externalId,
            effectiveName
        );
        customer = await resolveWebMenuCustomerByChannelIdentity(
            admin,
            input.companyId,
            { channel: link.channel, externalId: link.externalId },
            displayName ?? effectiveName
        );

        if (customer?.needsPhone && phoneBody.trim()) {
            const phoneNorm = normalizeBrMobilePhone(phoneBody);
            if (!phoneNorm.ok) {
                return { ok: false, error: "phone_invalid", status: 400 };
            }
            const channelName =
                (await resolveChannelDisplayNameForMenu(
                    admin,
                    input.companyId,
                    link.channel,
                    link.externalId,
                    customer.name
                )) ?? null;
            if (!effectiveName && !channelName && customer.isNew) {
                return { ok: false, error: "name_required", status: 400 };
            }
            const linked = await linkWebMenuCustomerPhone(
                admin,
                input.companyId,
                customer.id,
                phoneBody
            );
            if (!linked.ok) {
                const status =
                    linked.error === "phone_invalid"
                        ? 400
                        : linked.error === "customer_not_found"
                          ? 404
                          : 422;
                return {
                    ok: false,
                    error: linked.error,
                    status,
                };
            }
            customer = linked.customer;
            matchedExistingCustomer = linked.merged;

            const finalName = pickCustomerNameAfterPhoneLink({
                existingName: customer.name,
                formName: effectiveName,
                channelName,
            });
            if (finalName && finalName !== (customer.name ?? "").trim()) {
                await admin
                    .from("customers")
                    .update({ name: finalName })
                    .eq("id", customer.id)
                    .eq("company_id", input.companyId);
                customer = { ...customer, name: finalName };
            } else if (customer.name) {
                customer = { ...customer, name: customer.name.trim() };
            }
        } else if (customer && displayName && isGenericCustomerDisplayName(customer.name)) {
            await admin
                .from("customers")
                .update({ name: displayName.slice(0, 120) })
                .eq("id", customer.id)
                .eq("company_id", input.companyId);
            customer = { ...customer, name: displayName };
        }
    }

    if (!customer) {
        return { ok: false, error: "customer_failed", status: 500 };
    }

    const needsPhone = Boolean(customer.needsPhone);
    const addresses =
        needsPhone || !customer.phoneE164
            ? []
            : await listCustomerAddressesForMenu(admin, input.companyId, customer.id);

    const sessionToken = signWebMenuCheckoutSession({
        companyId: input.companyId,
        customerId: customer.id,
        phoneE164: customer.phoneE164 || "",
        slug: input.slug,
        name: customer.name,
        channel,
        externalId,
        needsPhone,
    });

    return {
        ok: true,
        data: {
            ok: true,
            sessionToken,
            needsPhone,
            customer: {
                id: customer.id,
                name: customer.name,
                phoneE164: customer.phoneE164 || "",
                isNew: customer.isNew,
                needsPhone,
            },
            addresses,
            channel: channel ?? "whatsapp",
            matchedExistingCustomer: matchedExistingCustomer || undefined,
        },
    };
}

export async function readMenuSessionFromToken(
    admin: SupabaseClient,
    params: {
        companyId: string;
        slug: string;
        sessionToken: string;
    }
): Promise<PublicMenuSessionOk | null> {
    const { verifyWebMenuCheckoutSession } = await import("./sessionToken");
    const session = verifyWebMenuCheckoutSession(params.sessionToken);
    if (!session || session.companyId !== params.companyId || session.slug !== params.slug) {
        return null;
    }

    const { data: customerRow } = await admin
        .from("customers")
        .select("id, name, phone_e164")
        .eq("id", session.customerId)
        .eq("company_id", params.companyId)
        .maybeSingle();

    if (!customerRow?.id) return null;

    const needsPhone = Boolean(session.needsPhone);
    const phoneE164 = session.phoneE164 || customerRow.phone_e164 || "";
    const addresses =
        needsPhone || !phoneE164
            ? []
            : await listCustomerAddressesForMenu(admin, params.companyId, session.customerId);

    return {
        ok: true,
        sessionToken: params.sessionToken,
        needsPhone,
        customer: {
            id: customerRow.id,
            name: customerRow.name ?? session.name,
            phoneE164,
            isNew: false,
            needsPhone,
        },
        addresses,
        channel: session.channel ?? "whatsapp",
    };
}
