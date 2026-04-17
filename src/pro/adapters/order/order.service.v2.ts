import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderService } from "../../services/order/order.types";
import type { DraftAddress, OrderDraft, OrderServiceResult } from "@/src/types/contracts";
import { getOrCreateCustomer } from "@/lib/chatbot/db/orders";
import { loadPackRowForValidation } from "@/lib/chatbot/pro/prepareOrderDraft";

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
            return "Nao encontramos esse produto ou embalagem no catalogo. Confirme o item ou escolha outro.";
        case "OUT_OF_STOCK":
            if (details?.itemName) return `Estoque insuficiente para "${details.itemName}".`;
            return details?.hint ?? "Um item ficou sem estoque ou com preco diferente. Peça um novo resumo no chat.";
        case "INVALID_ADDRESS":
            return "Nao consegui validar o endereco. Confira rua, numero e bairro.";
        case "INVALID_PAYMENT":
            return "Forma de pagamento invalida.";
        case "INCONSISTENT_DRAFT":
            return "Dados inconsistentes do pedido. Revise os itens e tente novamente.";
        case "DB_ERROR":
            return "Nao consegui cadastrar o cliente. Tente novamente.";
        case "RPC_ERROR":
            return "Nao consegui salvar o pedido. Tente de novo em instantes.";
        case "MIN_ORDER_NOT_MET":
            return "Pedido abaixo do minimo para entrega.";
        case "DELIVERY_AREA_NOT_SUPPORTED":
            return "No momento nao atendemos esse endereco.";
        default:
            return "Nao consegui concluir seu pedido agora. Tente novamente.";
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

function paymentLabel(method: "pix" | "cash" | "card"): string {
    if (method === "pix") return "PIX";
    if (method === "card") return "Cartao";
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
        .map((item) => `${item.quantity}x ${item.productName}`)
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
    const deliveryFeeText =
        draft.deliveryFee > 0 ? ` Taxa R$ ${moneyBr(draft.deliveryFee)}.` : " Taxa R$ 0,00.";

    if (requireApproval) {
        return `Pedido ${orderCode} recebido. Itens: ${items}. Total R$ ${moneyBr(safeGrandTotal)} via ${payment}.${deliveryFeeText} Estamos confirmando e ja voltamos.`;
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

            const need = item.quantity * loaded.row.fator_conversao;
            if (loaded.estoque < need) {
                return {
                    ok: false,
                    message: buildOrderErrorMessage("OUT_OF_STOCK", { itemName: item.productName }),
                    errorCode: "OUT_OF_STOCK",
                };
            }
        }

        if (!draft.address?.logradouro || !draft.address.numero || !draft.address.bairro) {
            return { ok: false, message: buildOrderErrorMessage("INVALID_ADDRESS"), errorCode: "INVALID_ADDRESS" };
        }

        if (!draft.paymentMethod) {
            return { ok: false, message: buildOrderErrorMessage("INVALID_PAYMENT"), errorCode: "INVALID_PAYMENT" };
        }

        return { ok: true };
    }

    async createFromDraft(input: Parameters<OrderService["createFromDraft"]>[0]): Promise<OrderServiceResult> {
        const { tenant, draft } = input;
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

        const customer = await getOrCreateCustomer(this.admin, tenant.companyId, tenant.phoneE164, null);
        if (!customer?.id) {
            return {
                ok: false,
                customerMessage: buildOrderErrorMessage("DB_ERROR"),
                errorCode: "DB_ERROR",
                retryable: true,
            };
        }

        const address = draft.address;
        if (!address) {
            return {
                ok: false,
                customerMessage: buildOrderErrorMessage("INVALID_ADDRESS"),
                errorCode: "INVALID_ADDRESS",
                retryable: false,
            };
        }

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

        const { data: deliveryEnderecoClienteId, error: addrErr } = await this.admin.rpc(
            "rpc_chatbot_pro_upsert_endereco_cliente",
            {
                p_company_id: tenant.companyId,
                p_customer_id: customer.id,
                p_payload: payload,
            }
        );

        if (addrErr || !deliveryEnderecoClienteId) {
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

        const { data: settings } = await this.admin
            .from("company_settings")
            .select("require_order_approval")
            .eq("company_id", tenant.companyId)
            .maybeSingle();

        const requireApproval = Boolean(settings?.require_order_approval);
        const confirmationStatus = requireApproval ? "pending_confirmation" : "confirmed";
        const deliveryAddress = draft.deliveryAddressText || buildAddressText(address);

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
            // `orders.source` CHECK só permite chatbot|ui|pdv_direct|flow_* (ver migrations).
            p_source: "chatbot",
            p_channel: "whatsapp",
            p_total_amount: draft.grandTotal,
            p_total: draft.totalItems,
            p_delivery_fee: draft.deliveryFee,
            p_delivery_address: deliveryAddress,
            p_delivery_endereco_cliente_id: deliveryEnderecoClienteId,
            p_payment_method: draft.paymentMethod,
            p_change_for: draft.changeFor ?? null,
            p_paid: false,
            p_items: itemsPayload,
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

        const code = `#${String(orderId).replaceAll("-", "").slice(-6).toUpperCase()}`;
        const customerMessage = buildOrderCustomerMessage({
            orderCode: code,
            requireApproval,
            draft,
        });

        return {
            ok: true,
            orderId: String(orderId),
            customerMessage,
            requireApproval,
        };
    }
}

