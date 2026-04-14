import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiOrderCanonicalDraft, AiOrderAddress, AiOrderItem } from "./typesAiOrder";
import { lookupDeliveryZone } from "./resolveDeliveryZone";
import { resolveDefaultAddressForCustomer } from "./resolveSavedAddress";
import { parsePtQuantity } from "./parseQtyPt";
import { tryParseAddressOneLine } from "./parseAddressLoosePt";
import { roundBrl } from "../utils";

export interface PrepareDraftToolInput {
    items: Array<{ produto_embalagem_id: string; quantity: number | string }>;
    address: {
        logradouro:  string;
        numero:      string;
        bairro:      string;
        complemento?: string | null;
        apelido?:    string | null;
    } | null;
    /** Linha única (ex.: "Rua Tangará 850 São Mateus") — o servidor separa rua/número/bairro. */
    address_raw?: string | null;
    /** Quando true, preenche o endereço a partir do cadastro / último pedido (cliente já identificado). */
    use_saved_address?: boolean;
    payment_method?:   string | null;
    change_for?:       number | null;
    /** Se true e tudo válido, o estado fica pronto para confirmação explícita do cliente. */
    ready_for_confirmation?: boolean;
}

function normPm(raw: string | null | undefined): "pix" | "cash" | "card" | null {
    if (!raw) return null;
    const s = raw.trim().toLowerCase();
    if (s === "pix" || s.includes("pix")) return "pix";
    if (s === "cash" || s === "dinheiro" || s.includes("dinheiro")) return "cash";
    if (s === "card" || s.includes("cartao") || s.includes("cartão")) return "card";
    return null;
}

export async function loadPackRowForValidation(
    admin: SupabaseClient,
    companyId: string,
    packId: string
): Promise<{
    row: {
        id: string; product_name: string; preco_venda: number; fator_conversao: number; product_volume_id: string | null;
    };
    estoque: number;
} | null> {
    const { data: pe } = await admin
        .from("view_chat_produtos")
        .select("id, company_id, product_name, preco_venda, fator_conversao, product_volume_id")
        .eq("id", packId)
        .maybeSingle();

    if (!pe || String((pe as { company_id: string }).company_id) !== companyId) return null;

    const productVolumeId = (pe as { product_volume_id: string | null }).product_volume_id;
    let estoque           = 0;
    if (productVolumeId) {
        const { data: vol } = await admin
            .from("product_volumes")
            .select("estoque_atual")
            .eq("id", productVolumeId)
            .maybeSingle();
        estoque = Number(vol?.estoque_atual ?? 0);
    } else {
        const { data: emb } = await admin
            .from("produto_embalagens")
            .select("produto_id")
            .eq("id", packId)
            .eq("company_id", companyId)
            .maybeSingle();
        const produtoId = emb?.produto_id as string | undefined;
        if (produtoId) {
            const { data: vol } = await admin
                .from("product_volumes")
                .select("estoque_atual")
                .eq("product_id", produtoId)
                .order("volume_quantidade", { ascending: true, nullsFirst: true })
                .limit(1)
                .maybeSingle();
            estoque = Number(vol?.estoque_atual ?? 0);
        }
    }

    return {
        row: {
            id:                pe.id as string,
            product_name:      String((pe as { product_name: string }).product_name ?? ""),
            preco_venda:       roundBrl(Number.parseFloat(String((pe as { preco_venda: unknown }).preco_venda ?? "0"))),
            fator_conversao:   Number.parseFloat(String((pe as { fator_conversao: unknown }).fator_conversao ?? "1")) || 1,
            product_volume_id: productVolumeId,
        },
        estoque,
    };
}

function buildAddressText(addr: AiOrderAddress, bairroLabel: string): string {
    return [addr.logradouro, addr.numero, addr.complemento, bairroLabel || addr.bairro]
        .filter(Boolean)
        .join(", ");
}

export async function prepareOrderDraftFromTool(
    admin: SupabaseClient,
    companyId: string,
    customerId: string | null,
    body: PrepareDraftToolInput
): Promise<{
    ok:    boolean;
    draft: AiOrderCanonicalDraft | null;
    errors: string[];
}> {
    const errors: string[] = [];

    if (!body.items?.length) errors.push("Inclua pelo menos um item com produto_embalagem_id e quantity.");

    let address: AiOrderAddress | null = body.address
        ? {
            logradouro:  String(body.address.logradouro ?? "").trim(),
            numero:      String(body.address.numero ?? "").trim(),
            bairro:      String(body.address.bairro ?? "").trim(),
            complemento: body.address.complemento ? String(body.address.complemento).trim() : null,
            apelido:     body.address.apelido ? String(body.address.apelido).trim() : null,
        }
        : null;

    const rawLine = body.address_raw?.trim();
    if (rawLine) {
        const parsed = tryParseAddressOneLine(rawLine);
        if (parsed) {
            address = {
                logradouro:  address?.logradouro?.trim() || parsed.logradouro,
                numero:      address?.numero?.trim() || parsed.numero,
                bairro:      address?.bairro?.trim() || parsed.bairro,
                complemento: address?.complemento ?? null,
                apelido:     address?.apelido ?? null,
            };
        }
    }

    let addressNote: string | null = null;

    if (body.use_saved_address) {
        if (!customerId) {
            errors.push("Não há cliente identificado pelo telefone para usar endereço salvo.");
        } else {
            const resolved = await resolveDefaultAddressForCustomer(admin, companyId, customerId);
            if (!resolved) {
                errors.push("Não encontrei endereço salvo; peça rua, número e bairro.");
            } else {
                address     = resolved.address;
                addressNote = resolved.note;
            }
        }
    }

    if (address && (!address.logradouro || !address.numero || !address.bairro)) {
        errors.push("Endereço incompleto: obrigatório rua, número e bairro.");
    }

    const pm = normPm(body.payment_method ?? null);
    if (!pm) errors.push("Informe payment_method: pix, cash ou card.");

    const itemsOut: AiOrderItem[] = [];
    for (const line of body.items ?? []) {
        const qty = parsePtQuantity(line.quantity);
        if (!line.produto_embalagem_id || qty == null) {
            errors.push("Cada item precisa de produto_embalagem_id (UUID) e quantity inteira ≥ 1 (número ou por extenso).");
            continue;
        }
        const loaded = await loadPackRowForValidation(admin, companyId, line.produto_embalagem_id);
        if (!loaded) {
            errors.push(`Embalagem inválida ou de outra empresa: ${line.produto_embalagem_id}`);
            continue;
        }
        const { row, estoque } = loaded;
        const need = qty * row.fator_conversao;
        if (estoque < need) {
            errors.push(
                `Estoque insuficiente para "${row.product_name}" (pediu ${qty}; disponível ~${Math.floor(estoque / row.fator_conversao)} na unidade de venda).`
            );
            continue;
        }
        itemsOut.push({
            produto_embalagem_id: row.id,
            product_name:         row.product_name,
            quantity:             qty,
            unit_price:           row.preco_venda,
            fator_conversao:      row.fator_conversao,
            product_volume_id:    row.product_volume_id,
            estoque_unidades:     estoque,
        });
    }

    let delivery_fee          = 0;
    let delivery_zone_id: string | null = null;
    let bairroLabel           = "";
    let delivery_address_text: string | null = null;

    if (address && !errors.some((e) => e.includes("Endereço incompleto"))) {
        const zone = await lookupDeliveryZone(admin, companyId, address.bairro);
        if (!zone) {
            errors.push(`Não encontrei zona de entrega para o bairro "${address.bairro}". Confira o bairro ou outra grafia.`);
        } else {
            delivery_fee         = zone.fee;
            delivery_zone_id     = zone.id;
            bairroLabel          = zone.label;
            address.bairro_label = zone.label;
            delivery_address_text = buildAddressText(address, bairroLabel);
        }
    }

    const total_items = roundBrl(itemsOut.reduce((s, i) => s + i.unit_price * i.quantity, 0));
    const grand_total = roundBrl(total_items + delivery_fee);

    const baseErrors = [...errors];
    const draft: AiOrderCanonicalDraft | null =
        baseErrors.length === 0 && itemsOut.length && address && pm
            ? {
                items:                  itemsOut,
                address,
                payment_method:         pm,
                change_for:             body.change_for ?? null,
                delivery_fee,
                delivery_zone_id,
                delivery_address_text,
                total_items,
                grand_total,
                pending_confirmation: Boolean(body.ready_for_confirmation),
                address_resolution_note: addressNote,
            }
            : null;

    return {
        ok:     draft !== null,
        draft,
        errors: draft ? [] : (baseErrors.length ? baseErrors : ["Rascunho incompleto."]),
    };
}
