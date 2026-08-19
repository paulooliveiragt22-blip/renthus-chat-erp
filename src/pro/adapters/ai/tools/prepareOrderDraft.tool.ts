import { tool } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderDraftPort } from "@/src/pro/ports/orderDraft.port";
import type { PrepareDraftToolTelemetryPayload } from "@/src/types/contracts";
import { getOrCreateCustomer } from "@/lib/chatbot/db/orders";
import { normalizePrepareDraftAnthropicInput } from "@/src/pro/tools/normalizePrepareDraftAnthropicInput";
import { sanitizePreparePaymentAgainstUserText } from "@/src/pro/pipeline/sanitizePreparePayment";
import {
    mergePreparedDraftIntoCurrent,
    unionAllowlistWithDraftIds,
} from "@/src/pro/pipeline/mergeOrderDraft";
import {
    buildPrepareDraftGuidanceForModel,
    type PrepareOrderDraftCatalogPolicy,
} from "@/src/pro/tools/prepareOrderDraft";
import type { TurnState } from "./turnState";

/**
 * Schema deliberadamente permissivo (`z.unknown()` nos campos compostos): a validação
 * de negócio real acontece em `prepareOrderDraftFromTool` (via `normalizePrepareDraftAnthropicInput`,
 * que já tolera sinônimos snake_case/camelCase do modelo). Um schema Zod estrito aqui só
 * arriscaria `InvalidToolInputError` abortando o turno por causa de formatação, não de negócio.
 */
const prepareOrderDraftInputSchema = z.object({
    items: z
        .array(z.unknown())
        .optional()
        .describe(
            "Itens do pedido: cada um com produto_embalagem_id (UUID do último search_produtos) e quantity."
        ),
    address: z
        .unknown()
        .optional()
        .describe("Endereço estruturado: logradouro, numero, bairro, complemento, cidade, estado, cep."),
    address_raw: z.string().optional().describe("Endereço em uma linha, texto livre do cliente."),
    saved_address_id: z.string().optional().describe("UUID de um endereço salvo (get_order_hints)."),
    use_saved_address: z.unknown().optional().describe("true para usar o endereço padrão salvo do cliente."),
    payment_method: z.string().optional().describe("pix | cash | card — só se o cliente já informou."),
    change_for: z.unknown().optional().describe("Valor do troco em reais — só se o cliente pediu."),
    ready_for_confirmation: z.unknown().optional(),
    order_notes: z
        .string()
        .optional()
        .describe(
            "Observação do pedido inteiro, texto livre do cliente (ex.: sem alface, tocar campainha). Não é por item."
        ),
});

/**
 * Wrapper Vercel AI SDK de `prepare_order_draft` (Fase 3, ver
 * docs/PLANO_MIGRACAO_VERCEL_AI_SDK.md). Chama `prepareOrderDraftFromTool` (via
 * `OrderDraftPort`, shape já com `blocked` desde a Fase 1) e mantém no `TurnState` o
 * draft mesclado com o de rounds anteriores do mesmo turno.
 */
export function createPrepareOrderDraftTool(deps: {
    admin: SupabaseClient;
    orderDraft: OrderDraftPort;
    companyId: string;
    threadId: string;
    customerId: string | null;
    profileName: string | null;
    phoneE164: string;
    userText: string;
    turnState: TurnState;
    onPrepareDraftToolResult?: (payload: PrepareDraftToolTelemetryPayload) => void;
    /**
     * Modo só informações (`aiOrderMode: "info_only"`): mantém a tool no `ToolSet` (evita
     * key opcional/união instável no generic de `generateText`), mas nunca valida/mescla
     * rascunho de verdade — só devolve `info_only_mode` para o modelo.
     */
    disabled?: boolean;
}) {
    return tool({
        description:
            "Valida item/endereço/pagamento no servidor e devolve rascunho canônico com totais e erros. Sempre leia guidance_for_model_pt na resposta antes de escrever para o cliente.",
        inputSchema: prepareOrderDraftInputSchema,
        execute: async (raw) => {
            if (deps.disabled) {
                return {
                    ok: false,
                    error: "info_only_mode",
                    guidance_for_model_pt: [
                        "Modo só informações: não feche pedido. Oriente cardápio web ou atendente.",
                    ],
                };
            }
            const toolInput = sanitizePreparePaymentAgainstUserText(
                normalizePrepareDraftAnthropicInput(raw as Record<string, unknown>),
                deps.userText,
                deps.turnState.currentDraft
            );

            let effectiveCustomerId = deps.customerId;
            if (!effectiveCustomerId) {
                const c = await getOrCreateCustomer(
                    deps.admin,
                    deps.companyId,
                    deps.phoneE164,
                    deps.profileName
                );
                effectiveCustomerId = c?.id ?? null;
            }

            const allowedEmbalagemIds = unionAllowlistWithDraftIds(
                deps.turnState.allowlistIds,
                deps.turnState.currentDraft
            );
            const catalogPolicy: PrepareOrderDraftCatalogPolicy = {
                kind: "search_allowlist",
                allowedEmbalagemIds,
            };

            const prepared = await deps.orderDraft.prepareFromToolInput({
                companyId: deps.companyId,
                customerId: effectiveCustomerId,
                body: toolInput,
                catalogPolicy,
            });

            const addrIn = toolInput.address;
            const hasStructuredAddress = Boolean(
                addrIn &&
                    String(addrIn.logradouro ?? "").trim() &&
                    String(addrIn.numero ?? "").trim() &&
                    String(addrIn.bairro ?? "").trim()
            );
            const hasAddressPayload =
                Boolean(toolInput.savedAddressId?.trim()) ||
                Boolean(toolInput.useSavedAddress) ||
                Boolean(toolInput.addressRaw?.trim()) ||
                hasStructuredAddress;

            const nextDraft = mergePreparedDraftIntoCurrent(deps.turnState.currentDraft, prepared.draft);
            deps.turnState.currentDraft = nextDraft;
            deps.turnState.prepareInvokedThisTurn = true;
            deps.turnState.lastPrepareOutcome = { ok: prepared.ok, errors: [...prepared.errors] };

            deps.onPrepareDraftToolResult?.({
                companyId: deps.companyId,
                threadId: deps.threadId,
                ok: prepared.ok,
                errors: prepared.errors,
                hasItems: (toolInput.items?.length ?? 0) > 0,
                hasAddress: hasAddressPayload,
                payment_method: toolInput.paymentMethod ?? null,
                draftItemCount: nextDraft?.items?.length ?? 0,
            });

            const allowedIds = allowedEmbalagemIds.length ? [...allowedEmbalagemIds] : [];
            const baseGuidance = buildPrepareDraftGuidanceForModel(prepared.ok, prepared.errors, {
                blocked: prepared.blocked ?? null,
                hasPartialDraft: Boolean(nextDraft?.items?.length) && !prepared.ok,
            });
            const idHint =
                !prepared.ok && allowedIds.length
                    ? [
                          `allowed_produto_embalagem_ids: copie um destes valores para items[].produto_embalagem_id ou items[].id no próximo prepare_order_draft: ${allowedIds.join(", ")}.`,
                      ]
                    : [];

            return {
                ok: prepared.ok,
                errors: prepared.errors,
                has_draft: Boolean(nextDraft),
                draft_item_count: nextDraft?.items?.length ?? 0,
                blocked: prepared.blocked ?? null,
                ...(!prepared.ok && allowedIds.length ? { allowed_produto_embalagem_ids: allowedIds } : {}),
                guidance_for_model_pt: [...baseGuidance, ...idHint],
            };
        },
    });
}
