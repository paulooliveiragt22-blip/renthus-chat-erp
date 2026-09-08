/**
 * Grupos de escolha de embalagem pendentes (UN/CX/Fardo/Pacote) quando 2+ produtos
 * distintos ficam ambíguos no mesmo turno (ex.: "quero skol e original", ambos com
 * mais de uma embalagem no catálogo).
 *
 * Substitui a antiga estratégia de "um card de botão por vez" (que descartava
 * silenciosamente o 2º produto pendente — ver docs/PLANO_MIGRACAO_VERCEL_AI_SDK.md,
 * bug do S2) por uma pergunta única em texto livre cobrindo todos os produtos
 * pendentes, resolvida deterministicamente pelo mesmo motor de sigla comercial já
 * validado em `resolveSegmentPick`/`packagingDisambiguation.ts` — sem depender de a
 * IA redigir/interpretar a ambiguidade em prosa livre.
 */
import { resolveSegmentPick } from "./resolveSegmentPick";
import {
    extractExplicitOrderQuantityFromText,
} from "@/src/pro/tools/parseQtyPt";
import { formatCatalogVolumeLabel } from "@/src/pro/tools/catalogPublicDto";
import { formatPackSiglaLabel } from "@/lib/products/packDisplayName";
import { explicitCommercialSiglaFromText } from "@/src/pro/tools/tagAliasMatch";
import type { CompanySigla, CustomerSiglaHabit } from "./customerPackagingHabit";
import type { PendingPickGroup, PendingPickOption } from "@/src/types/contracts";

export type { PendingPickGroup, PendingPickOption };

export type ResolvedPendingPick = {
    productKey: string;
    embalagemId: string;
    quantity: number;
};

const MAX_GROUPS = 3;
const MAX_OPTIONS_PER_GROUP = 4;
/** Turnos sem resolução até cair para botão determinístico só do item restante. */
export const PENDING_PICK_SAFETY_NET_TURNS = 2;

function normalize(text: string): string {
    return String(text ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/g, " ")
        .trim();
}

export function productKeyFromRows(rows: Array<{ product_name?: string | null }>): string {
    const name = rows.find((r) => r.product_name)?.product_name ?? "";
    return normalize(name);
}

/**
 * Chave estável a partir do termo de busca do cliente — usada quando as linhas ambíguas
 * NÃO são a mesma família de embalagem (ex.: "original" batendo em "ORIGINAL 600ML" e
 * "ORIGINAL LATA", produtos distintos no catálogo). Diferente de `productKeyFromRows`,
 * não depende de as linhas compartilharem `product_name`.
 */
export function productKeyFromQuery(query: string): string {
    return normalize(query);
}

type SourceRow = {
    id: string;
    display_name?: string | null;
    product_name?: string | null;
    sigla_comercial?: string | null;
    preco_venda?: number | string | null;
    fator_conversao?: number | string | null;
    volume_quantidade?: number | string | null;
    unit_type_sigla?: string | null;
    volume_label?: string | null;
};

export function buildPendingPickGroup(
    productKey: string,
    productLabel: string,
    rows: SourceRow[],
    opts?: {
        requestedQuantity?: number | null;
        lineId?: string | null;
        unavailableRequestedSigla?: string | null;
    }
): PendingPickGroup {
    const qty = opts?.requestedQuantity;
    const lineId = String(opts?.lineId ?? "").trim();
    if (!lineId) {
        throw new Error("buildPendingPickGroup requires opts.lineId (ADR 0011)");
    }
    const unavailable = String(opts?.unavailableRequestedSigla ?? "")
        .trim()
        .toUpperCase();
    return {
        lineId,
        productKey,
        productLabel,
        unresolvedTurns: 0,
        requestedQuantity:
            qty != null && Number.isFinite(qty) && qty >= 1 ? Math.floor(qty) : null,
        ...(unavailable ? { unavailableRequestedSigla: unavailable } : {}),
        options: rows.slice(0, MAX_OPTIONS_PER_GROUP).map((r) => {
            const volumeLabel =
                String(r.volume_label ?? "").trim() ||
                formatCatalogVolumeLabel(r.volume_quantidade, r.unit_type_sigla);
            return {
                embalagemId: String(r.id),
                displayName: String(r.display_name ?? "").trim() || null,
                productName: String(r.product_name ?? "").trim() || null,
                siglaComercial: String(r.sigla_comercial ?? "").trim() || null,
                precoVenda: Number.isFinite(Number(r.preco_venda)) ? Number(r.preco_venda) : null,
                fatorConversao: Number.isFinite(Number(r.fator_conversao))
                    ? Number(r.fator_conversao)
                    : null,
                volumeLabel,
            };
        }),
    };
}

/** Group válido para clarify/outbound (≥2 opts, ou ≥1 com mismatch de sigla). */
export function isPendingPickGroupClarifyEligible(group: PendingPickGroup): boolean {
    const n = group.options?.length ?? 0;
    if (n >= 2) return true;
    if (n >= 1 && String(group.unavailableRequestedSigla ?? "").trim()) return true;
    return false;
}

/** Insere/substitui um grupo por `productKey` (não duplica o mesmo produto); cap em MAX_GROUPS. */
export function upsertPendingPickGroup(
    groups: readonly PendingPickGroup[],
    next: PendingPickGroup
): PendingPickGroup[] {
    const withoutSame = groups.filter((g) => g.productKey !== next.productKey);
    return [...withoutSame, next].slice(-MAX_GROUPS);
}

/** Remove qualquer grupo que contenha esta embalagem entre as opções (pick por botão/número). */
export function removePendingPickGroupContaining(
    groups: readonly PendingPickGroup[],
    embalagemId: string
): PendingPickGroup[] {
    return groups.filter((g) => !g.options.some((o) => o.embalagemId === embalagemId));
}

export function removePendingPickGroupsByKeys(
    groups: readonly PendingPickGroup[],
    productKeys: readonly string[]
): PendingPickGroup[] {
    const reject = new Set(productKeys);
    return groups.filter((g) => !reject.has(g.productKey));
}

function siglaLabelPt(option: PendingPickOption): string {
    const vol = (option.volumeLabel ?? "").trim();
    const sigla = (option.siglaComercial ?? "").trim().toUpperCase();
    const pack = formatPackSiglaLabel(sigla || "UN", option.fatorConversao);
    let base = "opção";
    if (sigla === "UN") base = "unidade";
    else if (sigla === "CX") base = "caixa";
    else if (sigla === "FARD") base = "fardo";
    else if (sigla === "PAC") base = "pacote";
    else if (option.displayName?.trim()) base = option.displayName.trim();
    else if (sigla) base = sigla.toLowerCase();
    const withPack = `${base} (${pack})`;
    return vol ? `${withPack} · ${vol}` : withPack;
}

/**
 * `true` quando as opções NÃO se diferenciam só por sigla comercial (UN/CX/Fardo), e sim
 * por nome/rótulo distinto — produtos diferentes no mesmo termo (ORIGINAL 600ML vs LATA)
 * OU variantes do mesmo produto com display distinto (MARMITA P / M / G, todos UN).
 */
function isMixedProductGroup(group: PendingPickGroup): boolean {
    const productNames = new Set(
        group.options.map((o) => normalize(o.productName ?? "")).filter((n) => n.length > 0)
    );
    if (productNames.size > 1) return true;
    const displayNames = new Set(
        group.options.map((o) => normalize(o.displayName ?? "")).filter((n) => n.length > 0)
    );
    return displayNames.size > 1;
}

function optionDisplayLabel(option: PendingPickOption): string {
    const name = option.displayName?.trim() || option.productName?.trim() || siglaLabelPt(option);
    const pack = formatPackSiglaLabel(option.siglaComercial, option.fatorConversao);
    /** Já veio de siglaLabelPt com (UN:1) — não duplicar. */
    if (name.includes(`(${pack})`)) return name;
    return `${name} (${pack})`;
}

function optionClarifyLabel(group: PendingPickGroup, option: PendingPickOption): string {
    return isMixedProductGroup(group) ? optionDisplayLabel(option) : siglaLabelPt(option);
}

/** Texto canônico do que acabou de ser anotado (nunca prosa da IA). */
export function buildResolvedPendingPicksAck(
    resolved: readonly ResolvedPendingPick[],
    sourceGroups: readonly PendingPickGroup[]
): string | null {
    if (!resolved.length) return null;
    const lines: string[] = [];
    for (const r of resolved) {
        const group = sourceGroups.find((g) => g.productKey === r.productKey);
        const opt = group?.options.find((o) => o.embalagemId === r.embalagemId);
        const label = opt && group ? optionClarifyLabel(group, opt) : "item";
        const productBit = group?.productLabel?.trim() ? `${group.productLabel.trim()} — ` : "";
        lines.push(`• ${r.quantity}× ${productBit}${label}`);
    }
    return `Anotei:\n${lines.join("\n")}`;
}

type FlatPendingPick = {
    group: PendingPickGroup;
    option: PendingPickOption;
    /** Índice 1-based na lista enviada ao cliente. */
    index: number;
};

/** Achata opções na mesma ordem da mensagem numerada (cap global = MAX_GROUPS * MAX_OPTIONS). */
export function flattenPendingPickOptions(
    groups: readonly PendingPickGroup[]
): FlatPendingPick[] {
    const out: FlatPendingPick[] = [];
    let index = 1;
    for (const group of groups.slice(0, MAX_GROUPS)) {
        for (const option of group.options.slice(0, MAX_OPTIONS_PER_GROUP)) {
            out.push({ group, option, index });
            index += 1;
        }
    }
    return out;
}

/**
 * Índice 1-based quando a mensagem é só escolha ("1", "opção 2", "segunda") —
 * não casa "2 MARMITA P" (qty + nome).
 */
export function parsePendingPickIndex(text: string, maxIndex: number): number | null {
    const t = normalize(text);
    if (!t || maxIndex < 1) return null;

    if (/^\d{1,2}$/u.test(t)) {
        const n = Number(t);
        return n >= 1 && n <= maxIndex ? n : null;
    }

    const mOpcao = t.match(/^(?:opcao|op)\s*(\d{1,2})$/u);
    if (mOpcao) {
        const n = Number(mOpcao[1]);
        return n >= 1 && n <= maxIndex ? n : null;
    }

    const mNumero = t.match(/^(?:numero|n[uº]?)\s*(\d{1,2})$/u);
    if (mNumero) {
        const n = Number(mNumero[1]);
        return n >= 1 && n <= maxIndex ? n : null;
    }

    const ordinalWord: Record<string, number> = {
        primeira: 1,
        primeiro: 1,
        segunda: 2,
        segundo: 2,
        terceira: 3,
        terceiro: 3,
        quarta: 4,
        quarto: 4,
    };
    if (ordinalWord[t] != null) {
        const n = ordinalWord[t]!;
        return n <= maxIndex ? n : null;
    }
    const mOrd = t.match(
        /^(primeira|primeiro|segunda|segundo|terceira|terceiro|quarta|quarto)(?:\s+opcao)?$/u
    );
    if (mOrd) {
        const n = ordinalWord[mOrd[1]!] ?? null;
        return n != null && n <= maxIndex ? n : null;
    }
    return null;
}

/**
 * Mensagem consolidada 100% determinística (nunca a prosa da IA). Lista numerada para o
 * cliente responder com o número (ex.: "1") — cobre embalagem UN/CX e variantes P/M/G.
 * Sem card de botões (teto WA = 3; ver bug S2 / PLANO_MIGRACAO_VERCEL_AI_SDK).
 */
export function buildPickClarificationFreeText(groups: readonly PendingPickGroup[]): string {
    if (!groups.length) return "Encontrei mais de uma opção. Me diga qual deseja.";

    const flat = flattenPendingPickOptions(groups);
    const showGroupHeaders = groups.length > 1;
    const lines: string[] = [];
    let currentKey: string | null = null;

    for (const row of flat) {
        if (showGroupHeaders && row.group.productKey !== currentKey) {
            currentKey = row.group.productKey;
            lines.push(`• ${row.group.productLabel}`);
        }
        lines.push(`${row.index}. ${optionClarifyLabel(row.group, row.option)}`);
    }

    const mismatchOnly =
        groups.length === 1 && String(groups[0]!.unavailableRequestedSigla ?? "").trim();
    if (mismatchOnly) {
        const g = groups[0]!;
        const pack = labelForUnknownPackagingSigla(String(g.unavailableRequestedSigla));
        const label = g.productLabel || g.productKey || "este item";
        const single = g.options.length === 1;
        return (
            `Não trabalhamos com ${pack} em ${label}. ` +
            (single ? "Opção disponível:\n\n" : "Opções disponíveis:\n\n") +
            lines.join("\n") +
            (single
                ? "\n\nConfirma? Digite 1 (ou o nome da opção)."
                : "\n\nSelecione qual deseja (digite o número, ex.: 1).")
        );
    }

    const mismatchAny = groups.some((g) => String(g.unavailableRequestedSigla ?? "").trim());
    if (mismatchAny) {
        const bits = groups
            .filter((g) => String(g.unavailableRequestedSigla ?? "").trim())
            .map((g) => {
                const pack = labelForUnknownPackagingSigla(String(g.unavailableRequestedSigla));
                return `${pack} em ${g.productLabel || g.productKey}`;
            });
        return (
            `Não trabalhamos com ${bits.join("; ")}.\n\n` +
            "Opções disponíveis:\n\n" +
            lines.join("\n") +
            "\n\nSelecione qual deseja (digite o número, ex.: 1)."
        );
    }

    return (
        "Encontrei mais de uma opção:\n\n" +
        lines.join("\n") +
        "\n\nSelecione qual deseja (digite o número, ex.: 1)."
    );
}

function optionToHitRow(o: PendingPickOption) {
    return {
        id: o.embalagemId,
        display_name: o.displayName,
        product_name: o.productName,
        sigla_comercial: o.siglaComercial,
        preco_venda: o.precoVenda,
        fator_conversao: o.fatorConversao,
    };
}

function extractQuantityFromText(text: string): number | null {
    return extractExplicitOrderQuantityFromText(text);
}

function groupRequestedQty(group: PendingPickGroup): number {
    const q = Number(group.requestedQuantity);
    return Number.isFinite(q) && q >= 1 ? Math.floor(q) : 1;
}

/** "sim"/"ok"/"pode" após mismatch (só 1 embalagem disponível). */
function isAffirmativePackagingFallback(text: string): boolean {
    const t = normalize(String(text ?? ""));
    if (!t) return false;
    if (/^(sim|ok|pode|confirma|confirmar|isso|certo|fechado|blz|beleza)\b/u.test(t)) {
        return true;
    }
    return t === "1" || t === "unidade" || t === "un";
}

/** Divide a resposta do cliente em segmentos por produto (", "/" e "/"também"/"mais"). */
function splitIntoProductSegments(text: string): string[] {
    return String(text ?? "")
        .split(/\s*(?:,|;|\be\b|\btambém\b|\bmais\b)\s*/giu)
        .map((s) => s.trim())
        .filter(Boolean);
}

function groupTokens(group: PendingPickGroup): string[] {
    const fromLabel = normalize(group.productLabel).split(" ");
    const fromOptions = group.options.flatMap((o) => normalize(o.productName ?? "").split(" "));
    return [...new Set([...fromLabel, ...fromOptions])].filter((t) => t.length >= 3);
}

function pickSegmentForGroup(group: PendingPickGroup, segments: readonly string[]): string | null {
    const tokens = groupTokens(group);
    for (const seg of segments) {
        const segNorm = normalize(seg);
        if (tokens.some((t) => segNorm.includes(t))) return seg;
    }
    return null;
}

/**
 * Pré-checagem específica de grupo "misto" (produtos/variantes com nomes distintos, não
 * apenas embalagem do mesmo produto): casa o segmento contra o nome/descrição real de
 * cada opção. `resolveSegmentPick` sozinho não cobre bem esse caso porque seu vocabulário
 * de "brand tokens" trata palavras de formato (ex.: "lata") como ruído a descartar — o que
 * é correto quando é só embalagem do mesmo produto, mas quebra quando essa palavra faz
 * parte do NOME do produto que diferencia as opções (ex.: "ORIGINAL LATA" vs "ORIGINAL 600ML").
 */
function matchMixedGroupOptionByName(
    group: PendingPickGroup,
    segment: string
): PendingPickOption | null {
    if (!isMixedProductGroup(group)) return null;
    /** Inclui tokens curtos (P/M/G) — filtrar só ≥3 quebrava "2 MARMITA P" na Ferrester. */
    const segTokens = new Set(normalize(segment).split(" ").filter((t) => t.length >= 1));
    if (!segTokens.size) return null;
    const scored = group.options
        .map((o) => {
            const nameTokens = normalize(o.displayName ?? o.productName ?? "")
                .split(" ")
                .filter((t) => t.length >= 1);
            const hits = nameTokens.filter((t) => segTokens.has(t)).length;
            return { option: o, hits, nameTokens };
        })
        .filter((s) => s.hits > 0)
        .sort((a, b) => b.hits - a.hits);
    if (!scored.length) return null;
    const best = scored[0]!;
    const second = scored[1];
    if (second && second.hits === best.hits) {
        /** Empate no total: desempata por token distintivo curto (ex.: p vs m vs g). */
        const distinctive = [...segTokens].filter((t) => t.length <= 2);
        if (!distinctive.length) return null;
        const byDistinct = scored
            .map((s) => ({
                ...s,
                dHits: distinctive.filter((t) => s.nameTokens.includes(t)).length,
            }))
            .filter((s) => s.dHits > 0)
            .sort((a, b) => b.dHits - a.dHits);
        if (!byDistinct.length) return null;
        if (byDistinct[1] && byDistinct[1]!.dHits === byDistinct[0]!.dHits) return null;
        return byDistinct[0]!.option;
    }
    return best.option;
}

/**
 * Pergunta de disponibilidade ("tem skol?", "vc tem X") não é escolha de embalagem —
 * resolver aqui inventava UN com qty=1 e pulava pro checkout (bug real WhatsApp 2026-09-02).
 */
function looksLikeAvailabilityQuestion(text: string): boolean {
    const n = normalize(text);
    if (!n) return false;
    if (/\b(caixa|caixas|cx|unidade|unidades|\bun\b|fardo|pack|pacote|lata|garrafa|pet|long\s*neck)\b/u.test(n)) {
        return false;
    }
    return (
        /^(vc|voce|voces)\s+(tem|têm|vende)\b/u.test(n) ||
        /^(tem|têm|vende)\b/u.test(n) ||
        /\b(tem|têm|vende)\b.+\?$/u.test(n)
    );
}

function resolveOne(
    group: PendingPickGroup,
    segment: string,
    opts?: {
        habitSigla?: CustomerSiglaHabit | null;
        companySiglas?: CompanySigla[] | null;
    }
): { embalagemId: string; quantity: number } | null {
    if (looksLikeAvailabilityQuestion(segment)) return null;
    /**
     * Qty só entra no motor de sigla quando o cliente DIGITOU um número. Default `1` aqui
     * ativava `qty < fator_CX → prefer UN` e fechava embalagem sem o cliente escolher
     * (ex.: "vc tem skol?" → 1× SKOL LATA + botões de entrega).
     */
    const explicitQty = extractQuantityFromText(segment);
    const fallbackQty = groupRequestedQty(group);
    const byName = matchMixedGroupOptionByName(group, segment);
    if (byName) return { embalagemId: byName.embalagemId, quantity: explicitQty ?? fallbackQty };
    const hitRows = group.options.map(optionToHitRow);
    const result = resolveSegmentPick(segment, hitRows, {
        quantity: explicitQty,
        formatHintText: segment,
        habitSigla: opts?.habitSigla ?? null,
        companySiglas: opts?.companySiglas ?? null,
    });
    if (result.kind !== "unique") return null;
    return { embalagemId: result.pick.embalagemId, quantity: explicitQty ?? fallbackQty };
}

function optionSigla(o: PendingPickOption): string {
    return String(o.siglaComercial ?? "")
        .trim()
        .toUpperCase();
}

function groupHasSigla(group: PendingPickGroup, sigla: string): boolean {
    const want = sigla.trim().toUpperCase();
    return group.options.some((o) => optionSigla(o) === want);
}

function uniqueOptionForSigla(
    group: PendingPickGroup,
    sigla: string
): PendingPickOption | null {
    const want = sigla.trim().toUpperCase();
    const hits = group.options.filter((o) => optionSigla(o) === want);
    return hits.length === 1 ? hits[0]! : null;
}

/** Rótulo curto PT para sigla pedida e inexistente nas opções. */
export function labelForUnknownPackagingSigla(sigla: string): string {
    const s = sigla.trim().toUpperCase();
    if (s === "FARD") return "fardo";
    if (s === "PAC") return "pacote";
    if (s === "CX") return "caixa";
    if (s === "UN") return "unidade";
    return s.toLowerCase();
}

/**
 * Sigla falada que nenhuma opção dos grupos oferece (ex.: "fardo" com só UN/CX).
 */
export function detectUnknownPackagingAgainstGroups(
    groups: readonly PendingPickGroup[],
    userText: string
): string | null {
    const spoken = explicitCommercialSiglaFromText(userText);
    if (!spoken || !groups.length) return null;
    const anyHas = groups.some((g) => groupHasSigla(g, spoken));
    return anyHas ? null : spoken;
}

/**
 * Resposta só de embalagem ("caixa", "as duas em unidade") com 2+ grupos:
 * aplica a mesma sigla em todos se cada um tiver exatamente 1 opção com essa sigla.
 */
function tryBroadcastSharedPackaging(
    groups: readonly PendingPickGroup[],
    userText: string
): { resolved: ResolvedPendingPick[]; remaining: PendingPickGroup[] } | null {
    if (groups.length < 2) return null;
    const spoken = explicitCommercialSiglaFromText(userText);
    if (!spoken) return null;

    const segments = splitIntoProductSegments(userText);
    const mentionsProduct = groups.some((g) => pickSegmentForGroup(g, segments) != null);
    if (mentionsProduct) return null;

    const qty = extractQuantityFromText(userText);
    const resolved: ResolvedPendingPick[] = [];
    for (const group of groups) {
        const opt = uniqueOptionForSigla(group, spoken);
        if (!opt) return null;
        resolved.push({
            productKey: group.productKey,
            embalagemId: opt.embalagemId,
            quantity: qty ?? groupRequestedQty(group),
        });
    }
    return { resolved, remaining: [] };
}

/**
 * Resolve determinísticamente a resposta livre do cliente contra os grupos pendentes.
 * Sem chamada de IA — reaproveita o mesmo motor textual (sigla explícita, hábito,
 * quantidade vs. fator) já usado no `search_produtos`. Retorna o que deu pra fechar e
 * o que ainda ficou pendente (incrementando `unresolvedTurns` para a rede de segurança).
 */
export function resolvePendingPickGroupsFromFreeText(
    groups: readonly PendingPickGroup[],
    userText: string,
    opts?: {
        habitSigla?: CustomerSiglaHabit | null;
        companySiglas?: CompanySigla[] | null;
    }
): {
    resolved: ResolvedPendingPick[];
    remaining: PendingPickGroup[];
    /** Sigla pedida que não existe em nenhuma opção — caller deve avisar e escalar. */
    unknownPackagingSigla?: string | null;
} {
    if (!groups.length) return { resolved: [], remaining: [] };

    const unknownPack = detectUnknownPackagingAgainstGroups(groups, userText);
    if (unknownPack) {
        return {
            resolved: [],
            remaining: groups.map((g) => ({
                ...g,
                unresolvedTurns: PENDING_PICK_SAFETY_NET_TURNS,
            })),
            unknownPackagingSigla: unknownPack,
        };
    }

    /** Mismatch 1 opção: "1", "sim", "ok", "unidade" → aceita a disponível. */
    if (
        groups.length === 1 &&
        groups[0]!.options.length === 1 &&
        String(groups[0]!.unavailableRequestedSigla ?? "").trim()
    ) {
        const group = groups[0]!;
        const opt = group.options[0]!;
        const flatLen = 1;
        const pickIdx = parsePendingPickIndex(userText, flatLen);
        const affirmative = isAffirmativePackagingFallback(userText);
        const hit = resolveOne(group, userText, opts);
        if (pickIdx === 1 || affirmative || hit) {
            return {
                resolved: [
                    {
                        productKey: group.productKey,
                        embalagemId: (pickIdx === 1 || affirmative ? opt.embalagemId : null) ||
                            hit?.embalagemId ||
                            opt.embalagemId,
                        quantity:
                            pickIdx === 1 || affirmative
                                ? groupRequestedQty(group)
                                : (hit?.quantity ?? groupRequestedQty(group)),
                    },
                ],
                remaining: [],
            };
        }
    }

    const flat = flattenPendingPickOptions(groups);
    const pickIdx = parsePendingPickIndex(userText, flat.length);
    if (pickIdx != null) {
        const row = flat[pickIdx - 1];
        if (row) {
            return {
                resolved: [
                    {
                        productKey: row.group.productKey,
                        embalagemId: row.option.embalagemId,
                        quantity: groupRequestedQty(row.group),
                    },
                ],
                remaining: groups
                    .filter((g) => g.productKey !== row.group.productKey)
                    .map((g) => ({ ...g, unresolvedTurns: g.unresolvedTurns + 1 })),
            };
        }
    }

    if (groups.length === 1) {
        const group = groups[0]!;
        const hit = resolveOne(group, userText, opts);
        if (hit) {
            return {
                resolved: [{ productKey: group.productKey, embalagemId: hit.embalagemId, quantity: hit.quantity }],
                remaining: [],
            };
        }
        return { resolved: [], remaining: [{ ...group, unresolvedTurns: group.unresolvedTurns + 1 }] };
    }

    const broadcast = tryBroadcastSharedPackaging(groups, userText);
    if (broadcast) return broadcast;

    const segments = splitIntoProductSegments(userText);
    const usedSegments = new Set<string>();
    const resolved: ResolvedPendingPick[] = [];
    const remaining: PendingPickGroup[] = [];

    for (const group of groups) {
        const segment = pickSegmentForGroup(group, segments);
        if (!segment) {
            remaining.push({ ...group, unresolvedTurns: group.unresolvedTurns + 1 });
            continue;
        }
        const hit = resolveOne(group, segment, opts);
        if (!hit) {
            remaining.push({ ...group, unresolvedTurns: group.unresolvedTurns + 1 });
            continue;
        }
        usedSegments.add(segment);
        resolved.push({ productKey: group.productKey, embalagemId: hit.embalagemId, quantity: hit.quantity });
    }

    /** Sobrou 1 grupo sem segmento identificado e sobrou exatamente 1 segmento não usado: casa por exclusão. */
    if (remaining.length === 1 && resolved.length === groups.length - 1) {
        const leftoverSegments = segments.filter((s) => !usedSegments.has(s));
        if (leftoverSegments.length === 1) {
            const group = remaining[0]!;
            const hit = resolveOne(group, leftoverSegments[0]!, opts);
            if (hit) {
                resolved.push({ productKey: group.productKey, embalagemId: hit.embalagemId, quantity: hit.quantity });
                remaining.length = 0;
            }
        }
    }

    return { resolved, remaining };
}

/** Grupos que já passaram do teto de turnos sem resolução — devem cair para botão determinístico. */
export function groupsPastSafetyNet(groups: readonly PendingPickGroup[]): PendingPickGroup[] {
    return groups.filter((g) => g.unresolvedTurns >= PENDING_PICK_SAFETY_NET_TURNS);
}
