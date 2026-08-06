# Chatbot — motor único PRO + perfil de capacidade

`processInboundMessage` **sempre** usa o motor PRO (`runProInbound` → `runProPipeline` em `src/pro/`).

O plano comercial e o crédito IA definem um **`AiCapabilityProfile`** (`lib/chatbot/aiCapabilityProfile.ts`):

| Estado | Perfil | Comportamento |
|--------|--------|----------------|
| Sem plano / IA off / sem crédito / erro | `degradado` | Sem LLM; menu, status, handover e cardápio web; não fecha pedido por IA |
| `essencial` (+ crédito) | `basico` | Mesmo modelo; `maxToolRounds` 4, `maxHistoryTurns` 8 |
| `pro` / `market` (+ crédito) | `avancado` | Mesmo modelo; rounds 12, history 24 |

STT (`gpt-4o-mini-transcribe` por default) debita a carteira e só roda com crédito (`canUseAi`).

Alias legado: `getChatbotProductTier` em `tier.ts` sempre retorna `"pro"` (motor único).

---

*Última atualização: P0c — Starter removido; perfis de capacidade.*
