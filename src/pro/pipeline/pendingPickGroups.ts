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
import { parsePtQuantity } from "@/src/pro/tools/parseQtyPt";
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
};

export function buildPendingPickGroup(
    productKey: string,
    productLabel: string,
    rows: SourceRow[]
): PendingPickGroup {
    return {
        productKey,
        productLabel,
        unresolvedTurns: 0,
        options: rows.slice(0, MAX_OPTIONS_PER_GROUP).map((r) => ({
            embalagemId: String(r.id),
            displayName: String(r.display_name ?? "").trim() || null,
            productName: String(r.product_name ?? "").trim() || null,
            siglaComercial: String(r.sigla_comercial ?? "").trim() || null,
            precoVenda: Number.isFinite(Number(r.preco_venda)) ? Number(r.preco_venda) : null,
            fatorConversao: Number.isFinite(Number(r.fator_conversao))
                ? Number(r.fator_conversao)
                : null,
        })),
    };
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
    const sigla = (option.siglaComercial ?? "").trim().toUpperCase();
    if (sigla === "UN") return "unidade";
    if (sigla === "CX") return "caixa";
    if (sigla === "FARD") return "fardo";
    if (sigla === "PAC") return "pacote";
    return option.displayName?.trim() || sigla.toLowerCase() || "opção";
}

/**
 * `true` quando as opções do grupo NÃO são só embalagens (UN/CX/Fardo) do mesmo
 * produto, mas produtos/variantes com nomes distintos batendo no mesmo termo de busca
 * (ex.: "original" → "ORIGINAL 600ML" e "ORIGINAL LATA", cadastros diferentes). Nesse
 * caso, uma palavra de sigla genérica ("unidade"/"caixa") não basta pra diferenciar —
 * precisa do nome real de cada opção.
 */
function isMixedProductGroup(group: PendingPickGroup): boolean {
    const names = new Set(
        group.options.map((o) => normalize(o.productName ?? "")).filter((n) => n.length > 0)
    );
    return names.size > 1;
}

function optionDisplayLabel(option: PendingPickOption): string {
    return option.displayName?.trim() || option.productName?.trim() || siglaLabelPt(option);
}

function groupOptionLabels(group: PendingPickGroup): string[] {
    const labelFn = isMixedProductGroup(group) ? optionDisplayLabel : siglaLabelPt;
    return [...new Set(group.options.map(labelFn))];
}

/** Fragmento de exemplo ("1 caixa de Skol" ou, p/ produtos distintos, "1 ORIGINAL LATA"). */
function exampleFragment(group: PendingPickGroup, qty: number): string {
    if (isMixedProductGroup(group)) {
        return `${qty} ${optionDisplayLabel(group.options[0]!)}`;
    }
    return `${qty} ${siglaLabelPt(group.options[0]!)} de ${group.productLabel}`;
}

/**
 * Mensagem consolidada 100% determinística (nunca a prosa da IA) — evita tanto a
 * alucinação de disponibilidade quanto a redundância com um card de botões paralelo
 * (ver Frente 1 do diagnóstico do bug S2/redundância de mensagens). Cobre tanto
 * ambiguidade de embalagem de 1 produto quanto múltiplos produtos/variantes distintos
 * batendo no mesmo termo — texto livre não tem o teto de 3 opções dos botões do WhatsApp.
 */
export function buildPickClarificationFreeText(groups: readonly PendingPickGroup[]): string {
    const lines = groups.map((g) => `• ${g.productLabel}: ${groupOptionLabels(g).join(", ")}`);
    const first = groups[0]!;
    const second = groups[1];
    const example = second
        ? `"${exampleFragment(first, 1)} e ${exampleFragment(second, 2)}"`
        : `"${exampleFragment(first, 1)}"`;
    return (
        "Encontrei mais de uma opção pra alguns itens:\n\n" +
        lines.join("\n") +
        `\n\nMe diz o que você quer de cada um, com a quantidade (ex.: ${example}).`
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
    const digitMatch = String(text ?? "").match(/\b(\d{1,3})\b/u);
    if (digitMatch) {
        const n = Number(digitMatch[1]);
        if (Number.isFinite(n) && n >= 1) return n;
    }
    for (const tok of normalize(text).split(" ").filter(Boolean)) {
        const v = parsePtQuantity(tok);
        if (v != null) return v;
    }
    return null;
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
    const segTokens = new Set(normalize(segment).split(" ").filter((t) => t.length >= 3));
    if (!segTokens.size) return null;
    const scored = group.options
        .map((o) => {
            const nameTokens = normalize(o.displayName ?? o.productName ?? "")
                .split(" ")
                .filter((t) => t.length >= 3);
            const hits = nameTokens.filter((t) => segTokens.has(t)).length;
            return { option: o, hits };
        })
        .filter((s) => s.hits > 0)
        .sort((a, b) => b.hits - a.hits);
    if (!scored.length) return null;
    const best = scored[0]!;
    const second = scored[1];
    if (second && second.hits === best.hits) return null;
    return best.option;
}

function resolveOne(
    group: PendingPickGroup,
    segment: string
): { embalagemId: string; quantity: number } | null {
    const quantity = extractQuantityFromText(segment) ?? 1;
    const byName = matchMixedGroupOptionByName(group, segment);
    if (byName) return { embalagemId: byName.embalagemId, quantity };
    const hitRows = group.options.map(optionToHitRow);
    const result = resolveSegmentPick(segment, hitRows, {
        quantity,
        formatHintText: segment,
    });
    if (result.kind !== "unique") return null;
    return { embalagemId: result.pick.embalagemId, quantity };
}

/**
 * Resolve determinísticamente a resposta livre do cliente contra os grupos pendentes.
 * Sem chamada de IA — reaproveita o mesmo motor textual (sigla explícita, hábito,
 * quantidade vs. fator) já usado no `search_produtos`. Retorna o que deu pra fechar e
 * o que ainda ficou pendente (incrementando `unresolvedTurns` para a rede de segurança).
 */
export function resolvePendingPickGroupsFromFreeText(
    groups: readonly PendingPickGroup[],
    userText: string
): { resolved: ResolvedPendingPick[]; remaining: PendingPickGroup[] } {
    if (!groups.length) return { resolved: [], remaining: [] };

    if (groups.length === 1) {
        const group = groups[0]!;
        const hit = resolveOne(group, userText);
        if (hit) {
            return {
                resolved: [{ productKey: group.productKey, embalagemId: hit.embalagemId, quantity: hit.quantity }],
                remaining: [],
            };
        }
        return { resolved: [], remaining: [{ ...group, unresolvedTurns: group.unresolvedTurns + 1 }] };
    }

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
        const hit = resolveOne(group, segment);
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
            const hit = resolveOne(group, leftoverSegments[0]!);
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
