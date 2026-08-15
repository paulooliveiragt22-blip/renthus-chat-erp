import type { SupabaseClient } from "@supabase/supabase-js";
import type {
    DraftAddress,
    DraftItem,
    OrderDraft,
    PrepareDraftToolInput,
} from "@/src/types/contracts";
import {
    buildAiAddressFromSavedClienteRow,
    resolveDefaultAddressForCustomer,
    type SavedClienteEnderecoRow,
} from "./resolveSavedAddress";
import { parsePtQuantity } from "./parseQtyPt";
import { tryParseAddressOneLine } from "./parseAddressLoosePt";
import { roundBrl } from "@/lib/chatbot/utils";
import { resolveDeliveryForNeighborhood } from "@/lib/delivery/policy";
import { canFulfillQty } from "@/lib/products/stockPolicy";
import { buildPackDisplayName } from "@/lib/products/packDisplayName";
import type {
    PrepareOrderDraftBlockedReason,
    PrepareOrderDraftResult,
} from "@/src/pro/ports/orderDraft.port";
import { presentBlockedReasonForModel } from "@/src/pro/adapters/ai/blockedReasonPresenter";
import { loadAcceptedCustomerPayments } from "@/lib/payments/loadAcceptedCustomerPayments";
import {
    CUSTOMER_PAYMENT_LABELS,
    listEnabledCustomerPayments,
} from "@/src/financeiro/domain/acceptedCustomerPayments";

export type { PrepareDraftToolInput };

/** Formato de UUID esperado em `produto_embalagem_id` (ex.: `view_chat_produtos.id`). */
export function looksLikeCatalogEmbalagemUuid(value: string): boolean {
    const s = value.trim();
    return /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(s);
}

/**
 * Política de catálogo para `prepare_order_draft`.
 * - `unrestricted`: apenas validação no banco (sem allowlist de busca).
 * - `search_allowlist`: cada `produto_embalagem_id` tem de constar na última lista de `search_produtos` (PRO V2).
 */
export type PrepareOrderDraftCatalogPolicy =
    | { kind: "unrestricted" }
    | { kind: "search_allowlist"; allowedEmbalagemIds: readonly string[] };

function normPm(raw: string | null | undefined): "pix" | "cash" | "card" | "debit" | null {
    if (!raw) return null;
    const s = raw.trim().toLowerCase();
    if (s === "pix" || s.includes("pix")) return "pix";
    if (s === "cash" || s === "dinheiro" || s.includes("dinheiro")) return "cash";
    if (s === "debit" || s.includes("debito") || s.includes("débito")) return "debit";
    if (s === "card" || s.includes("cartao") || s.includes("cartão") || s.includes("credito") || s.includes("crédito")) {
        return "card";
    }
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
    venderComEstoqueZero: boolean;
} | null> {
    const { data: pe } = await admin
        .from("view_chat_produtos")
        .select(
            "id, company_id, product_name, display_name, descricao, sigla_comercial, volume_quantidade, unit_type_sigla, preco_venda, fator_conversao, product_volume_id, estoque_unidades, vender_com_estoque_zero, produto_id"
        )
        .eq("id", packId)
        .maybeSingle();

    if (!pe || String((pe as { company_id: string }).company_id) !== companyId) return null;

    const productVolumeId = (pe as { product_volume_id: string | null }).product_volume_id;
    let estoque = Number((pe as { estoque_unidades?: number }).estoque_unidades ?? NaN);
    let venderComEstoqueZero =
        (pe as { vender_com_estoque_zero?: boolean }).vender_com_estoque_zero !== false;

    if (!Number.isFinite(estoque)) {
        estoque = 0;
        if (productVolumeId) {
            const { data: vol } = await admin
                .from("product_volumes")
                .select("estoque_atual")
                .eq("id", productVolumeId)
                .maybeSingle();
            estoque = Number(vol?.estoque_atual ?? 0);
        } else {
            const produtoId =
                ((pe as { produto_id?: string }).produto_id as string | undefined) ??
                (
                    await admin
                        .from("produto_embalagens")
                        .select("produto_id")
                        .eq("id", packId)
                        .eq("company_id", companyId)
                        .maybeSingle()
                ).data?.produto_id;
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
    }

    // Flag pode ainda não estar na view (pré-migration): ler products
    if ((pe as { vender_com_estoque_zero?: boolean }).vender_com_estoque_zero === undefined) {
        const produtoId = (pe as { produto_id?: string }).produto_id;
        if (produtoId) {
            const { data: prod } = await admin
                .from("products")
                .select("vender_com_estoque_zero")
                .eq("id", produtoId)
                .eq("company_id", companyId)
                .maybeSingle();
            if (prod && "vender_com_estoque_zero" in prod) {
                venderComEstoqueZero = prod.vender_com_estoque_zero !== false;
            }
        }
    }

    const peRow = pe as {
        product_name?: string;
        display_name?: string | null;
        descricao?: string | null;
        sigla_comercial?: string | null;
        volume_quantidade?: number | string | null;
        unit_type_sigla?: string | null;
        preco_venda?: unknown;
        fator_conversao?: unknown;
    };
    const displayName =
        (typeof peRow.display_name === "string" && peRow.display_name.trim()) ||
        buildPackDisplayName({
            productName: peRow.product_name,
            itemName: peRow.descricao,
            sigla: peRow.sigla_comercial,
            volumeQuantidade: peRow.volume_quantidade,
            unitSigla: peRow.unit_type_sigla,
            fatorConversao: peRow.fator_conversao as number,
        });

    return {
        row: {
            id:                pe.id as string,
            product_name:      displayName,
            preco_venda:       roundBrl(Number.parseFloat(String(peRow.preco_venda ?? "0"))),
            fator_conversao:   Number.parseFloat(String(peRow.fator_conversao ?? "1")) || 1,
            product_volume_id: productVolumeId,
        },
        estoque,
        venderComEstoqueZero,
    };
}

function buildAddressText(addr: DraftAddress, bairroLabel: string): string {
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
    body: PrepareDraftToolInput,
    catalogPolicy: PrepareOrderDraftCatalogPolicy = { kind: "unrestricted" }
): Promise<PrepareOrderDraftResult> {
    const errors: string[] = [];

    if (!body.items?.length) errors.push("Inclua pelo menos um item com produto_embalagem_id e quantity.");

    let address: DraftAddress | null = body.address
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

    const savedAddrId = body.savedAddressId?.trim();
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

    const rawLine = body.addressRaw?.trim();
    if (rawLine && !savedAddrId) {
        const parsed = tryParseAddressOneLine(rawLine);
        if (parsed) {
            address = {
                logradouro:         address?.logradouro?.trim() || parsed.logradouro,
                numero:             address?.numero?.trim() || parsed.numero,
                bairro:             address?.bairro?.trim() || parsed.bairro,
                complemento:        address?.complemento ?? null,
                apelido:            address?.apelido ?? null,
                cidade:             address?.cidade ?? null,
                estado:             address?.estado ?? null,
                cep:                address?.cep ?? null,
                enderecoClienteId:  address?.enderecoClienteId ?? null,
            };
        }
    }

    let addressNote: string | null = null;

    if (body.useSavedAddress && !savedAddrId) {
        if (!customerId) {
            errors.push("Não há cliente identificado pelo telefone para usar endereço salvo.");
        } else {
            const resolved = await resolveDefaultAddressForCustomer(admin, companyId, customerId);
            if (!resolved) {
                errors.push("Não encontrei endereço salvo; peça rua, número, bairro e cidade.");
            } else {
                address     = resolved.address;
                addressNote = resolved.note;
            }
        }
    }

    const ufOk = address?.estado && String(address.estado).trim().length >= 2;
    if (address && (!address.logradouro || !address.numero || !address.bairro || !address.cidade?.trim() || !ufOk)) {
        errors.push("Endereço incompleto: obrigatório rua, número, bairro, cidade e UF (2 letras).");
    }

    const pm = normPm(body.paymentMethod ?? null);
    const acceptedPay = await loadAcceptedCustomerPayments(admin, companyId);
    if (!pm) {
        const opts = listEnabledCustomerPayments(acceptedPay)
            .map((m) => CUSTOMER_PAYMENT_LABELS[m])
            .join(", ");
        errors.push(
            opts
                ? `Informe payment_method entre: ${opts} (pix|cash|card|debit conforme habilitado).`
                : "Loja sem forma de pagamento habilitada."
        );
    } else if (!acceptedPay[pm]) {
        errors.push(
            `Forma de pagamento "${pm}" não aceita. Use: ${listEnabledCustomerPayments(acceptedPay).join("|")}.`
        );
    }

    const allowSet =
        catalogPolicy.kind === "search_allowlist" ? new Set(catalogPolicy.allowedEmbalagemIds) : null;
    if (
        catalogPolicy.kind === "search_allowlist" &&
        (body.items?.length ?? 0) > 0 &&
        allowSet &&
        allowSet.size === 0
    ) {
        errors.push(
            "Faça search_produtos nesta conversa antes de prepare_order_draft; só é permitido produto_embalagem_id devolvido na lista da última busca."
        );
    }

    const itemsOut: DraftItem[] = [];
    const singleCatalogLine =
        catalogPolicy.kind === "search_allowlist" &&
        allowSet &&
        allowSet.size === 1 &&
        (body.items?.length ?? 0) === 1;

    type PlannedLine = { pid: string; qty: number };
    const planned: PlannedLine[] = [];

    for (const line of body.items ?? []) {
        const qty = parsePtQuantity(line.quantity);
        let pid = String(line.produtoEmbalagemId ?? "").trim();
        if (singleCatalogLine && qty != null && allowSet) {
            const sole = [...allowSet][0];
            if (!pid || (looksLikeCatalogEmbalagemUuid(pid) && !allowSet.has(pid))) {
                pid = sole;
            }
        }
        if (!pid || qty == null) {
            errors.push("Cada item precisa de produto_embalagem_id (UUID) e quantity inteira ≥ 1 (número ou por extenso).");
            continue;
        }
        if (catalogPolicy.kind === "search_allowlist" && allowSet) {
            if (allowSet.size === 0) {
                continue;
            }
            if (!looksLikeCatalogEmbalagemUuid(pid)) {
                errors.push(
                    "Cada item.produto_embalagem_id deve ser o UUID (campo id) copiado do array items do último search_produtos — não use slug, sku textual nem rótulo. Copie o id exato do JSON."
                );
                continue;
            }
            if (!allowSet.has(pid)) {
                errors.push(
                    `produto_embalagem_id não consta na última busca do catálogo: ${pid}. Rode search_produtos e use só ids retornados na lista.`
                );
                continue;
            }
        }
        planned.push({ pid, qty });
    }

    const loadedRows = await Promise.all(
        planned.map((p) => loadPackRowForValidation(admin, companyId, p.pid))
    );
    for (let i = 0; i < planned.length; i++) {
        const { pid, qty } = planned[i]!;
        const loaded = loadedRows[i];
        if (!loaded) {
            errors.push(`Embalagem inválida ou de outra empresa: ${pid}`);
            continue;
        }
        const { row, estoque, venderComEstoqueZero } = loaded;
        if (
            !canFulfillQty({
                venderComEstoqueZero,
                estoqueUnidades: estoque,
                fatorConversao: row.fator_conversao,
                qty,
            })
        ) {
            errors.push(
                `Estoque insuficiente para "${row.product_name}" (pediu ${qty}; disponível ~${Math.floor(estoque / row.fator_conversao)} na unidade de venda).`
            );
            continue;
        }
        itemsOut.push({
            produtoEmbalagemId: row.id,
            productName:        row.product_name,
            quantity:           qty,
            unitPrice:          row.preco_venda,
            fatorConversao:     row.fator_conversao,
            productVolumeId:    row.product_volume_id,
            estoqueUnidades:    estoque,
        });
    }

    let deliveryFee = 0;
    let deliveryZoneId: string | null = null;
    let bairroLabel = "";
    let deliveryAddressText: string | null = null;
    let deliveryMinOrder: number | null = null;
    let deliveryEtaMin: number | null = null;

    if (address && !errors.some((e) => e.includes("Endereço incompleto"))) {
        const resolved = await resolveDeliveryForNeighborhood(admin, companyId, address.bairro);
        if (!resolved.served) {
            errors.push(resolved.reason ?? `Bairro "${address.bairro}" fora da área de atendimento.`);
        } else {
            deliveryFee = resolved.fee;
            deliveryZoneId = resolved.matched_rule_id;
            bairroLabel = resolved.label;
            address.bairroLabel = resolved.label;
            deliveryAddressText = buildAddressText(address, bairroLabel);
            deliveryMinOrder = resolved.min_order;
            deliveryEtaMin = resolved.eta_min;
        }
    }

    const totalItems = roundBrl(itemsOut.reduce((s, i) => s + i.unitPrice * i.quantity, 0));
    const grandTotal = roundBrl(totalItems + deliveryFee);
    // Só avisa pedido mínimo quando já há pelo menos uma linha de item válida no catálogo;
    // evita misturar com erros de UUID/pagamento e confundir o cliente e o modelo.
    if (
        itemsOut.length > 0 &&
        deliveryMinOrder != null &&
        grandTotal < deliveryMinOrder
    ) {
        errors.push(`Pedido mínimo para entrega: R$ ${deliveryMinOrder.toFixed(2).replace(".", ",")}.`);
    }

    // Troco tem que cobrir o total — sem isso, `change_for` era só uma sugestão do modelo,
    // nunca validada no servidor (ver docs/PLANO_MIGRACAO_VERCEL_AI_SDK.md, Fase 1).
    const changeForRaw = body.changeFor ?? null;
    const invalidChangeFor =
        pm === "cash" && changeForRaw != null && changeForRaw > 0 && changeForRaw < grandTotal;
    if (invalidChangeFor) {
        errors.push(
            `Troco informado (R$ ${changeForRaw!.toFixed(2).replace(".", ",")}) é menor que o total do pedido (R$ ${grandTotal.toFixed(2).replace(".", ",")}).`
        );
    }

    const baseErrors = [...errors];
    const addressIncomplete = baseErrors.some((e) => /endereço incompleto|endereco incompleto/i.test(e));
    const outOfDeliveryZone = baseErrors.some((e) => /fora da área|fora da area/i.test(e));
    const addressUsable = Boolean(address) && !addressIncomplete && !outOfDeliveryZone;
    const belowMinimumOrder =
        itemsOut.length > 0 && deliveryMinOrder != null && grandTotal < deliveryMinOrder;
    const fullOk = baseErrors.length === 0 && itemsOut.length > 0 && Boolean(addressUsable) && Boolean(pm);

    // Draft completo OU parcial (itens válidos mesmo sem endereço/pagamento) — IA continua o fluxo.
    const draft: OrderDraft | null =
        itemsOut.length > 0
            ? {
                  items: itemsOut,
                  address: addressUsable ? address : null,
                  paymentMethod: pm,
                  changeFor: body.changeFor ?? null,
                  deliveryFee: addressUsable ? deliveryFee : 0,
                  deliveryZoneId: addressUsable ? deliveryZoneId : null,
                  deliveryAddressText: addressUsable ? deliveryAddressText : null,
                  deliveryMinOrder: addressUsable ? deliveryMinOrder : null,
                  deliveryEtaMin: addressUsable ? deliveryEtaMin : null,
                  totalItems,
                  grandTotal: addressUsable ? grandTotal : totalItems,
                  pendingConfirmation: fullOk,
                  addressResolutionNote: addressUsable ? addressNote : null,
                  version: 1,
              }
            : null;

    const blocked: PrepareOrderDraftBlockedReason | null = fullOk
        ? null
        : !itemsOut.length
          ? { code: "MISSING_ITEMS" }
          : !addressUsable
            ? outOfDeliveryZone
                ? { code: "OUT_OF_DELIVERY_ZONE", neighborhood: address?.bairro ?? "" }
                : { code: "ADDRESS_INCOMPLETE" }
            : belowMinimumOrder
              ? {
                    code: "BELOW_MIN_ORDER",
                    missing: roundBrl(deliveryMinOrder! - grandTotal),
                    minOrder: deliveryMinOrder!,
                }
              : !pm
                ? { code: "PAYMENT_MISSING" }
                : invalidChangeFor
                  ? { code: "INVALID_CHANGE_FOR", grandTotal, changeFor: changeForRaw! }
                  : { code: "FIX_ERRORS" };

    return {
        ok: fullOk,
        draft,
        errors: fullOk ? [] : baseErrors.length ? baseErrors : ["Rascunho incompleto."],
        blocked,
    };
}

/**
 * Instruções estáveis para o modelo após `prepare_order_draft`, alinhadas aos `errors` reais do servidor.
 * Reduz “erro técnico genérico” e respostas que ignoram validação (endereço, estoque, pagamento, etc.).
 */
export function buildPrepareDraftGuidanceForModel(
    ok: boolean,
    errors: string[],
    opts?: {
        deliveryAddressUiConfirmed?: boolean;
        blocked?: PrepareOrderDraftBlockedReason | null;
        hasPartialDraft?: boolean;
    }
): string[] {
    if (ok) {
        return [
            "Rascunho aceito no servidor (itens + endereço resolvido + pagamento).",
            "NÃO peça confirmação de endereço de novo (já batido no servidor se rua/número/bairro/cidade/UF ok).",
            "NÃO invente subtotal/taxa/total — o servidor envia o resumo oficial com taxa nos botões.",
            "No máximo 1 frase curta de confirmação de entendimento; sem listar preços nem pedir 'sim' do pedido (botão Confirmar do servidor).",
        ];
    }

    if (opts?.hasPartialDraft && opts.blocked && opts.blocked.code !== "FIX_ERRORS") {
        return presentBlockedReasonForModel(opts.blocked);
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
            "Próximo passo: se get_order_hints trouxe saved_addresses, liste-os; senão peça rua, número, bairro e cidade; use address_raw, address estruturado ou saved_address_id."
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
    if (errs.some((e) => /última busca|ultima busca|na lista da última|na lista da ultima/i.test(e))) {
        lines.push(
            "Próximo passo: chame search_produtos e copie produto_embalagem_id apenas do array items retornado na resposta."
        );
    }
    if (blob.includes("slug") || blob.includes("rótulo") || blob.includes("rotulo")) {
        lines.push(
            "Próximo passo: em items use somente o campo id (UUID) de cada linha em items do último search_produtos — nunca slug tipo \"marca-tamanho-caixa\"."
        );
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
