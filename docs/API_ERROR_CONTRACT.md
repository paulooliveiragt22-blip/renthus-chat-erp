# Contrato de erro das APIs (`app/api/**`)

Origem: item 7 de `docs/CHECKLIST_SEGURANCA_CONFIABILIDADE_P0.md`. Cada rota inventava seu próprio
formato de erro (`{error:"snake_case"}`, `{error: err.message}` vazando mensagem crua do Postgres,
`{error:"Erro interno"}`) — instável pra qualquer client (PDV, admin, Electron print agent, futuro
app mobile).

## Contrato

Toda resposta de erro de uma rota de API server-side (`app/api/**/route.ts`) que segue este padrão
devolve:

```json
{
  "error": {
    "code": "not_found",
    "message": "Thread não encontrada."
  }
}
```

- **`code`** — string estável em `snake_case`. Não muda entre releases; client pode fazer `switch`
  nele pra lógica (ex.: `code === "rate_limited"` pra mostrar retry). Nunca contém texto livre.
- **`message`** — texto legível pra exibir na UI. **Nunca** é `err.message` cru de driver
  Postgres/Supabase (pode vazar nome de tabela, coluna, constraint) nem stack trace.
- Campos extras são permitidos no mesmo nível de `error` quando fizerem sentido pro client (ex.:
  `confirmationId` num erro de envio que precisa ser referenciado depois), mas `error.code` e
  `error.message` são sempre obrigatórios.

O HTTP status code continua sendo a fonte primária de semântica (`401`, `403`, `404`, `409`, `429`,
`500`, `502`...); `error.code` é redundante de propósito (mais específico que o status, estável
mesmo se o status mudar por algum motivo).

## Helpers (`lib/api/errors.ts`)

```ts
import { jsonError, jsonAccessError, jsonInternalError, codeFromStatus } from "@/lib/api/errors";

// Erro conhecido, com code e mensagem definidos pela própria rota:
return jsonError("items_required", "Adicione ao menos um item ao carrinho.", 400);

// Falha de auth/tenant vinda de requireCompanyAccess (ctx.error é string curta tipo "Unauthorized"):
const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
if (!ctx.ok) return jsonAccessError(ctx);

// Exceção não tratada / erro de driver — loga (+ Sentry) e nunca vaza err.message pro client:
try {
  ...
} catch (err) {
  return jsonInternalError(err, { route: "whatsapp/threads/:id/cart" });
}
```

`jsonAccessError` existe pra não precisar alterar a assinatura de `requireCompanyAccess` (usado em
dezenas de rotas fora do piloto) — só traduz o `{ok:false, status, error}` que ele já devolve pro
envelope novo.

## Rotas migradas (piloto, 2026-08-11)

- `app/api/whatsapp/threads/[threadId]/cart/route.ts`
- `app/api/whatsapp/threads/[threadId]/cart/cancel-confirmation/route.ts`
- `app/api/whatsapp/threads/[threadId]/cart/send-confirmation/route.ts`
- `app/api/whatsapp/threads/[threadId]/orders/route.ts`
- `lib/security/cronAuth.ts` (usado por `app/api/billing/charge/route.ts` e outros crons)

Client atualizado pra ler o novo formato: `components/whatsapp/CartEditModal.tsx`
(`json?.error?.message` em vez de `json?.error`).

## Não migrado ainda (fora do escopo deste piloto)

O resto de `app/api/**` continua no formato antigo (`{error: "string"}` ou variantes). **Não é**
pra migrar tudo de uma vez — cada rota tocada por outro motivo deve migrar pro contrato novo nesse
momento (regra `arquitetura-lider.mdc`: não deixar dois padrões "por enquanto" sem prazo). Rota
nova sempre usa este contrato desde o início.
