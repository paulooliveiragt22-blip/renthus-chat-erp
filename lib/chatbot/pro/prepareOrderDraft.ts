import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiOrderCanonicalDraft, AiOrderAddress, AiOrderItem } from "./typesAiOrder";
import type { PrepareDraftToolInputLegacy as PrepareDraftToolInput } from "@/src/types/contracts.legacy";
import {
    buildAiAddressFromSavedClienteRow,
    resolveDefaultAddressForCustomer,
    type SavedClienteEnderecoRow,
} from "./resolveSavedAddress";
import { parsePtQuantity } from "./parseQtyPt";
import { tryParseAddressOneLine } from "./parseAddressLoosePt";
import { roundBrl } from "../utils";
import { resolveDeliveryForNeighborhood } from "@/lib/delivery/policy";

export type { PrepareDraftToolInput };

function normPm(raw: string | null | undefined): "pix" | "cash" | "card" | null {
    if (!raw) return null;
    const s = raw.trim().toLowerCase();
    if (s === "pix" || s.includes("pix")) return "pix";
    if (s === "cash" || s === "dinheiro" || s.includes("dinheiro")) return "cash";
    if (s === "card" || s.includes("cartao") || s.includes("cartão")) return "card";
    if (s.includes("debito") || s.includes("débito") || s.includes("credito") || s.includes("crédito")) return "card";
    if (s.includes("transfer") || s.includes("ted")) return "pix";
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
    return [
        addr.logradouro,
        addr.numero,
        addr.complemento,
        bairroLabel || addr.bairro,
        addr.cidade,
        addr.estado,
        addr.cep,
    ]
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
            cidade:      body.address.cidade ? String(body.address.cidade).trim() : null,
            estado:      body.address.estado ? String(body.address.estado).trim() : null,
            cep:         body.address.cep ? String(body.address.cep).trim() : null,
        }
        : null;

    const savedAddrId = body.saved_address_id?.trim();
    if (savedAddrId) {
        if (!customerId) {
            errors.push("Cliente não identificado; não dá para usar saved_address_id.");
        } else {
            const { data: row } = await admin
                .from("enderecos_cliente")
                .select("id, apelido, logradouro, numero, complemento, bairro, cidade, estado, cep")
                .eq("id", savedAddrId)
                .eq("company_id", companyId)
                .eq("customer_id", customerId)
                .maybeSingle();
            if (!row?.logradouro) {
                errors.push("saved_address_id inválido ou incompleto; use outro id de saved_addresses ou endereço digitado.");
            } else {
                const built = buildAiAddressFromSavedClienteRow(row as SavedClienteEnderecoRow);
                if (!built) {
                    errors.push("saved_address_id inválido ou incompleto; use outro id de saved_addresses ou endereço digitado.");
                } else {
                    address = built;
                }
            }
        }
    }

    const rawLine = body.address_raw?.trim();
    if (rawLine && !savedAddrId) {
        const parsed = tryParseAddressOneLine(rawLine);
        if (parsed) {
            address = {
                logradouro:           address?.logradouro?.trim() || parsed.logradouro,
                numero:               address?.numero?.trim() || parsed.numero,
                bairro:               address?.bairro?.trim() || parsed.bairro,
                complemento:          address?.complemento ?? null,
                apelido:              address?.apelido ?? null,
                cidade:               address?.cidade ?? null,
                estado:               address?.estado ?? null,
                cep:                  address?.cep ?? null,
                endereco_cliente_id:  address?.endereco_cliente_id ?? null,
            };
        }
    }

    let addressNote: string | null = null;

    if (body.use_saved_address && !savedAddrId) {
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
    let delivery_min_order: number | null = null;
    let delivery_eta_min: number | null = null;

    if (address && !errors.some((e) => e.includes("Endereço incompleto"))) {
        const resolved = await resolveDeliveryForNeighborhood(admin, companyId, address.bairro);
        if (!resolved.served) {
            errors.push(resolved.reason ?? `Bairro "${address.bairro}" fora da área de atendimento.`);
        } else {
            delivery_fee         = resolved.fee;
            delivery_zone_id     = resolved.matched_rule_id;
            bairroLabel          = resolved.label;
            address.bairro_label = resolved.label;
            delivery_address_text = buildAddressText(address, bairroLabel);
            delivery_min_order   = resolved.min_order;
            delivery_eta_min     = resolved.eta_min;
        }
    }

    const total_items = roundBrl(itemsOut.reduce((s, i) => s + i.unit_price * i.quantity, 0));
    const grand_total = roundBrl(total_items + delivery_fee);
    if (delivery_min_order != null && grand_total < delivery_min_order) {
        errors.push(`Pedido mínimo para entrega: R$ ${delivery_min_order.toFixed(2).replace(".", ",")}.`);
    }

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
                delivery_min_order,
                delivery_eta_min,
                total_items,
                grand_total,
                // Rascunho só existe com itens+endereço+pagamento válidos; sempre aguardar "sim"/"ok" no servidor
                // (a IA costuma esquecer ready_for_confirmation=true e o pedido nunca fechava).
                pending_confirmation: true,
                address_resolution_note: addressNote,
            }
            : null;

    return {
        ok:     draft !== null,
        draft,
        errors: draft ? [] : (baseErrors.length ? baseErrors : ["Rascunho incompleto."]),
    };
}

/**
 * Instruções estáveis para o modelo após `prepare_order_draft`, alinhadas aos `errors` reais do servidor.
 * Reduz “erro técnico genérico” e respostas que ignoram validação (endereço, estoque, pagamento, etc.).
 */
export function buildPrepareDraftGuidanceForModel(ok: boolean, errors: string[]): string[] {
    if (ok) {
        return [
            "Rascunho aceito no servidor.",
            "Resposta ao cliente: resuma itens, endereço, taxa e total exatamente como no draft (sem alterar preços).",
            "Se o draft estiver completo e pendente de confirmação, peça confirmação explícita (sim/ok ou botão) antes de considerar o pedido fechado.",
        ];
    }

    const errs = errors.filter(Boolean).slice(0, 8);
    const lines: string[] = [
        "Rascunho rejeitado pelo servidor.",
        "Não use mensagem genérica de \"erro técnico no catálogo\" quando a causa for validação (endereço, estoque, pagamento, área, etc.).",
        "Explique ao cliente de forma curta, com base nas mensagens abaixo (pode parafrasear, sem inventar dados):",
    ];
    if (!errs.length) lines.push("- Rascunho incompleto (sem detalhe adicional).");
    else for (const e of errs) lines.push(`- ${e}`);

    const blob = errs.join(" | ").toLowerCase();

    if (blob.includes("embalagem") || blob.includes("uuid") || blob.includes("outra empresa")) {
        lines.push(
            "Próximo passo: rode search_produtos com o termo do cliente e use somente produto_embalagem_id que aparecerem na lista retornada."
        );
    }
    if (blob.includes("pelo menos um item") || blob.includes("inclua")) {
        lines.push("Próximo passo: inclua items com produto_embalagem_id do último search_produtos.");
    }
    if (blob.includes("payment_method") || blob.includes("pagamento")) {
        lines.push(
            "Próximo passo: pergunte se paga em PIX, cartão ou dinheiro; depois chame prepare_order_draft de novo com payment_method (pix|cash|card)."
        );
    }
    if (blob.includes("endereço") || blob.includes("endereco") || blob.includes("bairro") || blob.includes("rua")) {
        lines.push(
            "Próximo passo: se get_order_hints trouxe saved_addresses, liste-os; senão peça rua, número e bairro; use address_raw, address estruturado ou saved_address_id."
        );
    }
    if (blob.includes("estoque")) {
        lines.push("Próximo passo: ofereça quantidade menor ou outro item da lista do search_produtos.");
    }
    if (blob.includes("mínimo") || blob.includes("minimo")) {
        lines.push("Próximo passo: explique o pedido mínimo e sugira acrescentar itens até atingir o valor.");
    }
    if (blob.includes("fora da área") || blob.includes("atendimento")) {
        lines.push("Próximo passo: informe que o bairro não está na área e peça outro endereço dentro da região atendida.");
    }
    if (blob.includes("cliente") && blob.includes("identificado")) {
        lines.push("Próximo passo: siga com get_order_hints; o telefone costuma criar o cadastro automaticamente na primeira interação.");
    }

    return lines;
}

/** Normaliza texto para comparação simples (acentos removidos). */
function normalizePtCompare(text: string): string {
    return text
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "");
}

/**
 * Mensagem ao cliente quando `prepare_order_draft` devolveu `ok:false` com erros de validação
 * (substitui "problema técnico" genérico da IA quando não há rascunho útil no estado).
 */
export function formatPrepareErrorsForClientReply(errors: string[]): string {
    const uniq = [...new Set(errors.map((e) => e.trim()).filter(Boolean))].slice(0, 6);
    const bullets = uniq.map((e) => `• ${e}`).join("\n");
    return (
        "Não consegui validar o pedido com os dados atuais:\n" +
        bullets +
        "\n\nAjuste o que faltar e envie de novo. Se apareceram endereços salvos nas dicas, pode escolher um deles."
    );
}

/**
 * Quando trocar a resposta visível do modelo pelos erros canónicos do `prepare_order_draft`.
 * Não usa quando já há itens no draft persistido (outro caminho corrige contradições).
 */
export function shouldPreferPrepareErrorsOverModelText(params: {
    visible: string;
    hasDraftItems: boolean;
    prepareOk: boolean | null;
    errors: string[];
}): boolean {
    const { visible, hasDraftItems, prepareOk, errors } = params;
    if (prepareOk === null || prepareOk === true || errors.length === 0) return false;
    if (hasDraftItems) return false;

    const v = visible.trim();
    if (!v) return true;

    const flat = normalizePtCompare(v);
    const genericHints = [
        "problema tecnico",
        "erro tecnico",
        "falha ao",
        "falha no",
        "nao consegui processar",
        "nao estou conseguindo",
        "erro ao processar",
        "instabilidade",
        "servidor",
        "tente novamente",
        "tente de novo",
        "falha temporaria",
        "falha temporária",
    ];
    if (genericHints.some((h) => flat.includes(h))) return true;
    if (v.length < 22) return true;
    return false;
}
