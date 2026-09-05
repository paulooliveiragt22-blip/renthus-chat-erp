import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderService } from "../../services/order/order.types";
import type { DraftAddress, OrderDraft, OrderServiceResult, PaymentMethod } from "@/src/types/contracts";
import { isPickupDraft } from "@/lib/delivery/fulfillment";
import { getOrCreateCustomer } from "@/lib/chatbot/db/orders";
import { resolveOrCreateCustomerByIdentity } from "@/lib/chatbot/db/channelIdentity";
import { loadPackRowForValidation } from "@/src/pro/tools/prepareOrderDraft";
import { canFulfillQty } from "@/lib/products/stockPolicy";
import { sanitizeOrderNotes } from "@/lib/orders/sanitizeOrderNotes";
import { formatPackSiglaLabel } from "@/lib/products/packDisplayName";
import { trackOrderCreatedServer } from "@/lib/analytics/mixpanelServer";
import type { OrderChannel } from "@/lib/analytics/types";

type OrderFailCode = Extract<OrderServiceResult, { ok: false }>["errorCode"];

const RETRYABLE_ORDER_ERRORS: ReadonlySet<OrderFailCode> = new Set(["RPC_ERROR", "DB_ERROR"]);

export function isRetryableOrderError(errorCode: OrderFailCode): boolean {
    return RETRYABLE_ORDER_ERRORS.has(errorCode);
}

export function buildOrderErrorMessage(
    errorCode: OrderFailCode,
    details?: { itemName?: string; hint?: string }
): string {
    switch (errorCode) {
        case "PRODUCT_NOT_FOUND":
            return "Não encontramos esse produto ou embalagem no catálogo. Confirme o item ou escolha outro.";
        case "OUT_OF_STOCK":
            if (details?.itemName) return `Estoque insuficiente para "${details.itemName}".`;
            return details?.hint ?? "Um item ficou sem estoque ou com preço diferente. Peça um novo resumo no chat.";
        case "INVALID_ADDRESS":
            return "Não consegui validar o endereço. Confira rua, número e bairro.";
        case "INVALID_PAYMENT":
            return "Forma de pagamento inválida.";
        case "INCONSISTENT_DRAFT":
            return "Dados inconsistentes do pedido. Revise os itens e tente novamente.";
        case "DB_ERROR":
            return "Não consegui cadastrar o cliente. Tente novamente.";
        case "RPC_ERROR":
            return "Não consegui salvar o pedido. Tente de novo em instantes.";
        case "MIN_ORDER_NOT_MET":
            return "Pedido abaixo do mínimo para entrega.";
        case "DELIVERY_AREA_NOT_SUPPORTED":
            return "No momento não atendemos esse endereço.";
        case "NEEDS_PHONE":
            return (
                "Para finalizar, preciso do seu WhatsApp com DDD (ex.: 11999998888). " +
                "É só uma vez — nas próximas compras já te reconheço."
            );
        default:
            return "Não consegui concluir seu pedido agora. Tente novamente.";
    }
}

function buildAddressText(address: DraftAddress): string {
    return [
        address.logradouro,
        address.numero,
        address.complemento,
        address.bairroLabel ?? address.bairro,
        address.cidade,
        address.estado,
        address.cep,
    ].filter(Boolean).join(", ");
}

function paymentLabel(method: PaymentMethod): string {
    if (method === "pix") return "PIX";
    if (method === "card") return "Cartão";
    if (method === "debit") return "Débito";
    return "Dinheiro";
}

function moneyBr(value: number): string {
    return value.toFixed(2).replace(".", ",");
}

function asCurrency(value: number): number {
    return Number(value.toFixed(2));
}

function buildItemsSummary(items: OrderDraft["items"]): string {
    return items
        .slice(0, 3)
        .map((item) => {
            const pack = formatPackSiglaLabel(item.siglaComercial, item.fatorConversao);
            return `${item.quantity}× ${item.productName} (${pack})`;
        })
        .join("; ");
}

export function buildOrderCustomerMessage(params: {
    orderCode: string;
    requireApproval: boolean;
    draft: OrderDraft;
}): string {
    const { orderCode, requireApproval, draft } = params;
    const payment = paymentLabel(draft.paymentMethod ?? "cash");
    const items = buildItemsSummary(draft.items);
    const recomputedItemsTotal = asCurrency(
        draft.items.reduce((acc, item) => acc + item.quantity * item.unitPrice, 0)
    );
    const recomputedGrandTotal = asCurrency(recomputedItemsTotal + draft.deliveryFee);
    const inconsistentGrandTotal = Math.abs(recomputedGrandTotal - draft.grandTotal) >= 0.02;
    const safeGrandTotal = inconsistentGrandTotal ? recomputedGrandTotal : draft.grandTotal;
    const deliveryFeeText = isPickupDraft(draft)
        ? " Retirada no local."
        : draft.deliveryFee > 0
          ? ` Taxa R$ ${moneyBr(draft.deliveryFee)}.`
          : " Taxa R$ 0,00.";

    if (requireApproval) {
        return `Pedido ${orderCode} recebido. Itens: ${items}. Total R$ ${moneyBr(safeGrandTotal)} via ${payment}.${deliveryFeeText} Estamos confirmando e já voltamos.`;
    }
    return `Pedido ${orderCode} confirmado. Itens: ${items}. Total R$ ${moneyBr(safeGrandTotal)} via ${payment}.${deliveryFeeText}`;
}

export function validateDraftConsistency(draft: OrderDraft): { ok: true } | { ok: false; message: string } {
    if (draft.items.length === 0) {
        return { ok: false, message: buildOrderErrorMessage("INCONSISTENT_DRAFT") };
    }
    for (const item of draft.items) {
        if (!Number.isFinite(item.quantity) || !Number.isFinite(item.unitPrice) || item.quantity <= 0 || item.unitPrice < 0) {
            return { ok: false, message: buildOrderErrorMessage("INCONSISTENT_DRAFT") };
        }
    }

    const recomputedItemsTotal = asCurrency(
        draft.items.reduce((acc, item) => acc + item.quantity * item.unitPrice, 0)
    );
    const recomputedGrandTotal = asCurrency(recomputedItemsTotal + draft.deliveryFee);
    if (Math.abs(recomputedItemsTotal - draft.totalItems) >= 0.02) {
        return { ok: false, message: buildOrderErrorMessage("INCONSISTENT_DRAFT") };
    }
    if (Math.abs(recomputedGrandTotal - draft.grandTotal) >= 0.02) {
        return { ok: false, message: buildOrderErrorMessage("INCONSISTENT_DRAFT") };
    }

    return { ok: true };
}

export class OrderServiceV2Adapter implements OrderService {
    constructor(private readonly admin: SupabaseClient) {}

    private async revalidateDraft(
        companyId: string,
        draft: NonNullable<Parameters<OrderService["createFromDraft"]>[0]["draft"]>
    ): Promise<{ ok: true } | { ok: false; message: string; errorCode: OrderFailCode }> {
        for (const item of draft.items) {
            const loaded = await loadPackRowForValidation(this.admin, companyId, item.produtoEmbalagemId);
            if (!loaded) {
                return {
                    ok: false,
                    message: buildOrderErrorMessage("PRODUCT_NOT_FOUND"),
                    errorCode: "PRODUCT_NOT_FOUND",
                };
            }

            const priceChanged = Math.abs(loaded.row.preco_venda - item.unitPrice) >= 0.02;
            if (priceChanged) {
                return {
                    ok: false,
                    message: buildOrderErrorMessage("OUT_OF_STOCK", {
                        hint: "O preco de um item mudou. Peça um novo resumo no chat.",
                    }),
                    errorCode: "OUT_OF_STOCK",
                };
            }

            if (
                !canFulfillQty({
                    venderComEstoqueZero: loaded.venderComEstoqueZero,
                    estoqueUnidades: loaded.estoque,
                    fatorConversao: loaded.row.fator_conversao,
                    qty: item.quantity,
                })
            ) {
                return {
                    ok: false,
                    message: buildOrderErrorMessage("OUT_OF_STOCK", { itemName: item.productName }),
                    errorCode: "OUT_OF_STOCK",
                };
            }
        }

        const ufOk = draft.address?.estado && String(draft.address.estado).trim().length >= 2;
        if (draft.fulfillmentType !== "pickup") {
            if (
                !draft.address?.logradouro ||
                !draft.address.numero ||
                !draft.address.bairro ||
                !draft.address.cidade?.trim() ||
                !ufOk
            ) {
                return { ok: false, message: buildOrderErrorMessage("INVALID_ADDRESS"), errorCode: "INVALID_ADDRESS" };
            }
        }

        if (!draft.paymentMethod) {
            return { ok: false, message: buildOrderErrorMessage("INVALID_PAYMENT"), errorCode: "INVALID_PAYMENT" };
        }

        return { ok: true };
    }

    async createFromDraft(input: Parameters<OrderService["createFromDraft"]>[0]): Promise<OrderServiceResult> {
        const { tenant, draft, idempotencyKey } = input;
        const fresh = await this.revalidateDraft(tenant.companyId, draft);
        if (!fresh.ok) {
            return {
                ok: false,
                customerMessage: fresh.message,
                errorCode: fresh.errorCode,
                retryable: isRetryableOrderError(fresh.errorCode),
            };
        }
        const consistency = validateDraftConsistency(draft);
        if (!consistency.ok) {
            return {
                ok: false,
                customerMessage: buildOrderErrorMessage("INCONSISTENT_DRAFT"),
                errorCode: "INCONSISTENT_DRAFT",
                retryable: false,
            };
        }

        const messagingChannel = tenant.messagingChannel ?? "whatsapp";
        const channelUserId = (tenant.channelUserId || tenant.phoneE164 || "").trim();

        let customerId: string | null = null;
        if (messagingChannel === "whatsapp") {
            const customer = await getOrCreateCustomer(
                this.admin,
                tenant.companyId,
                tenant.phoneE164,
                null
            );
            customerId = customer?.id ?? null;
        } else {
            if (!channelUserId) {
                return {
                    ok: false,
                    customerMessage: buildOrderErrorMessage("NEEDS_PHONE"),
                    errorCode: "NEEDS_PHONE",
                    retryable: false,
                };
            }
            const resolved = await resolveOrCreateCustomerByIdentity(this.admin, {
                companyId: tenant.companyId,
                identity: {
                    channel: messagingChannel,
                    externalId: channelUserId,
                },
                name: null,
                origem: messagingChannel,
            });
            if (!resolved?.customerId) {
                return {
                    ok: false,
                    customerMessage: buildOrderErrorMessage("DB_ERROR"),
                    errorCode: "DB_ERROR",
                    retryable: true,
                };
            }
            if (resolved.needsPhone) {
                return {
                    ok: false,
                    customerMessage: buildOrderErrorMessage("NEEDS_PHONE"),
                    errorCode: "NEEDS_PHONE",
                    retryable: false,
                };
            }
            customerId = resolved.customerId;
        }

        if (!customerId) {
            return {
                ok: false,
                customerMessage: buildOrderErrorMessage("DB_ERROR"),
                errorCode: "DB_ERROR",
                retryable: true,
            };
        }
        const customer = { id: customerId };

        const address = draft.address;
        const isPickup = draft.fulfillmentType === "pickup";
        if (!isPickup && !address) {
            return {
                ok: false,
                customerMessage: buildOrderErrorMessage("INVALID_ADDRESS"),
                errorCode: "INVALID_ADDRESS",
                retryable: false,
            };
        }

        let deliveryEnderecoClienteId: string | null = null;
        if (!isPickup && address) {
            const payload: Record<string, unknown> = {
                address_id: address.enderecoClienteId ?? null,
                apelido: address.apelido?.trim() || "WhatsApp",
                logradouro: address.logradouro,
                numero: address.numero,
                complemento: address.complemento ?? "",
                bairro: address.bairro,
                cidade: address.cidade ?? "",
                estado: address.estado ?? "",
                cep: address.cep ?? "",
                is_principal: true,
            };

            const { data: upsertedId, error: addrErr } = await this.admin.rpc(
                "rpc_chatbot_pro_upsert_endereco_cliente",
                {
                    p_company_id: tenant.companyId,
                    p_customer_id: customer.id,
                    p_payload: payload,
                }
            );

            if (addrErr || !upsertedId) {
                console.warn("[chatbot/order-v2] rpc_chatbot_pro_upsert_endereco_cliente failed", {
                    companyId: tenant.companyId,
                    threadId: tenant.threadId,
                    message: addrErr?.message,
                    code: addrErr?.code,
                });
                return {
                    ok: false,
                    customerMessage: buildOrderErrorMessage("INVALID_ADDRESS"),
                    errorCode: "INVALID_ADDRESS",
                    retryable: false,
                };
            }
            deliveryEnderecoClienteId = String(upsertedId);
        }

        const { data: settings } = await this.admin
            .from("company_settings")
            .select("require_order_approval")
            .eq("company_id", tenant.companyId)
            .maybeSingle();

        const requireApproval = Boolean(settings?.require_order_approval);
        const confirmationStatus = requireApproval ? "pending_confirmation" : "confirmed";
        const deliveryAddress = isPickup
            ? draft.deliveryAddressText?.trim() || "Retirada no local"
            : draft.deliveryAddressText || (address ? buildAddressText(address) : "");
        const deliveryFee = isPickup ? 0 : draft.deliveryFee;
        const fulfillmentType = isPickup ? "pickup" : "delivery";

        const itemsPayload = draft.items.map((item) => ({
            product_name: item.productName,
            produto_embalagem_id: item.produtoEmbalagemId,
            quantity: item.quantity,
            unit_price: item.unitPrice,
        }));

        const { data: orderId, error: orderErr } = await this.admin.rpc("create_order_with_items", {
            p_company_id: tenant.companyId,
            p_customer_id: customer.id,
            p_status: "new",
            p_confirmation_status: confirmationStatus,
            p_source: "ai_chat_pro_v2",
            p_channel: messagingChannel,
            p_total_amount: draft.grandTotal,
            p_total: draft.totalItems,
            p_delivery_fee: deliveryFee,
            p_delivery_address: deliveryAddress,
            p_delivery_endereco_cliente_id: deliveryEnderecoClienteId,
            p_payment_method: draft.paymentMethod,
            p_change_for: draft.changeFor ?? null,
            p_paid: false,
            p_items: itemsPayload,
            p_idempotency_key: idempotencyKey,
            p_fulfillment_type: fulfillmentType,
            p_order_notes: sanitizeOrderNotes(draft.orderNotes),
        });

        if (orderErr || !orderId) {
            console.warn("[chatbot/order-v2] create_order_with_items failed", {
                companyId: tenant.companyId,
                threadId: tenant.threadId,
                message: orderErr?.message,
                code: orderErr?.code,
                details: orderErr?.details,
                orderId,
            });
            return {
                ok: false,
                customerMessage: buildOrderErrorMessage("RPC_ERROR"),
                errorCode: "RPC_ERROR",
                retryable: true,
            };
        }

        /** Atribuição de receita recuperada; best-effort, nunca bloqueia o pedido. */
        const { error: recoveryErr } = await this.admin.rpc("mark_abandoned_cart_recovered", {
            p_company_id: tenant.companyId,
            p_thread_id: tenant.threadId,
            p_order_id: orderId,
        });
        if (recoveryErr) {
            console.warn("[chatbot/order-v2] mark_abandoned_cart_recovered failed", {
                companyId: tenant.companyId,
                threadId: tenant.threadId,
                message: recoveryErr.message,
            });
        }

        const code = `#${String(orderId).replaceAll("-", "").slice(-6).toUpperCase()}`;
        const customerMessage = buildOrderCustomerMessage({
            orderCode: code,
            requireApproval,
            draft,
        });

        const channelForAnalytics: OrderChannel =
            messagingChannel === "instagram" || messagingChannel === "messenger"
                ? messagingChannel
                : "whatsapp";
        void trackOrderCreatedServer(`company:${tenant.companyId}`, {
            channel: channelForAnalytics,
            offline: false,
            fulfillment_type: fulfillmentType,
            item_count: draft.items.length,
            company_id: tenant.companyId,
            order_id: String(orderId),
        });

        return {
            ok: true,
            orderId: String(orderId),
            customerMessage,
            requireApproval,
        };
    }
}

