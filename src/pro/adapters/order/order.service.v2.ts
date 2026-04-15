import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderService } from "../../services/order/order.types";
import type { DraftAddress, OrderServiceResult } from "@/src/types/contracts";
import { getOrCreateCustomer } from "@/lib/chatbot/db/orders";
import { loadPackRowForValidation } from "@/lib/chatbot/pro/prepareOrderDraft";

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

export class OrderServiceV2Adapter implements OrderService {
    constructor(private readonly admin: SupabaseClient) {}

    private async revalidateDraft(
        companyId: string,
        draft: NonNullable<Parameters<OrderService["createFromDraft"]>[0]["draft"]>
    ): Promise<{ ok: true } | { ok: false; message: string }> {
        for (const item of draft.items) {
            const loaded = await loadPackRowForValidation(this.admin, companyId, item.produtoEmbalagemId);
            if (!loaded) {
                return { ok: false, message: "Um produto deixou de estar disponivel. Ajuste o pedido no chat." } as const;
            }

            const priceChanged = Math.abs(loaded.row.preco_venda - item.unitPrice) >= 0.02;
            if (priceChanged) {
                return { ok: false, message: "O preco de um item mudou. Peça um novo resumo no chat." } as const;
            }

            const need = item.quantity * loaded.row.fator_conversao;
            if (loaded.estoque < need) {
                return { ok: false, message: `Estoque insuficiente para "${item.productName}".` } as const;
            }
        }

        if (!draft.address?.logradouro || !draft.address.numero || !draft.address.bairro) {
            return { ok: false, message: "Endereco incompleto." } as const;
        }

        if (!draft.paymentMethod) {
            return { ok: false, message: "Forma de pagamento invalida." } as const;
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
                errorCode: "OUT_OF_STOCK",
                retryable: false,
            };
        }

        const customer = await getOrCreateCustomer(this.admin, tenant.companyId, tenant.phoneE164, null);
        if (!customer?.id) {
            return {
                ok: false,
                customerMessage: "Nao consegui cadastrar o cliente. Tente novamente.",
                errorCode: "DB_ERROR",
                retryable: true,
            };
        }

        const address = draft.address;
        if (!address) {
            return {
                ok: false,
                customerMessage: "Endereco invalido.",
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
            return {
                ok: false,
                customerMessage: "Nao consegui salvar o endereco. Confira rua, numero e bairro.",
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
            p_source: "ai_chat_pro_v2",
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
            return {
                ok: false,
                customerMessage: "Nao consegui salvar o pedido. Tente de novo em instantes.",
                errorCode: "RPC_ERROR",
                retryable: true,
            };
        }

        const code = `#${String(orderId).replaceAll("-", "").slice(-6).toUpperCase()}`;
        const payment = paymentLabel(draft.paymentMethod ?? "cash");
        const customerMessage = requireApproval
            ? `Pedido ${code} recebido. Estamos confirmando e ja voltamos.`
            : `Pedido ${code} confirmado. Total R$ ${draft.grandTotal.toFixed(2).replace(".", ",")} via ${payment}.`;

        return {
            ok: true,
            orderId: String(orderId),
            customerMessage,
            requireApproval,
        };
    }
}

