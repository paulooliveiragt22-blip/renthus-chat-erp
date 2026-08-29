# 🤖 Usando Ollama Local (Llama 3.1 / Qwen2.5-Coder)

Este guia explica como rodar modelos LLM **localmente** na sua máquina para development/teste
do chatbot, sem custo de API (Anthropic ou OpenAI).

## Pré-requisitos

| Requisito | Valor |
|---|---|
| RAM | 8 GB no mínimo (16 GB recomendado) |
| Disco | ~5 GB livres por modelo |
| SO | Windows 10/11, macOS ou Linux |

## Passo a passo

### 1. Instalar o Ollama

Baixe em: **https://ollama.com/download**

Após instalar, o Ollama expõe uma API REST em `http://localhost:11434`.

### 2. Baixar um modelo

Escolha o modelo de acordo com a sua RAM:

```powershell
# Llama 3.1 8B — ~4.9 GB em disco, ~8 GB RAM
ollama pull llama3.1:8b

# Qwen2.5-Coder 7B — ~4.7 GB em disco, ~8 GB RAM (especializado em código)
ollama pull qwen2.5-coder:7b

# Qwen2.5-Coder 32B — ~20 GB em disco, ~24 GB RAM (equivalente ao GPT-4o em código)
ollama pull qwen2.5-coder:32b
```

Verifique que baixou corretamente:
```powershell
ollama list
```

### 3. Configurar o projeto

Edite o arquivo `.env.local` na raiz do projeto:

```env
# Muda o motor de IA do chatbot (default: anthropic)
LLM_PROVIDER=ollama

# Modelo a usar (default: llama3.1:8b)
LLM_MODEL=llama3.1:8b
# Alternativas populares:
# LLM_MODEL=qwen2.5-coder:7b
# LLM_MODEL=qwen2.5-coder:32b
```

### 4. (Opcional) Mudar a URL do Ollama

Se o Ollama estiver rodando em outra máquina ou porta diferente:

```env
OLLAMA_BASE_URL=http://192.168.1.100:11434/v1
```

### 5. Rodar o dev server

```powershell
npm run dev
```

### 6. Testar

Envie uma mensagem no WhatsApp para o chatbot. O Llama 3.1 vai responder no lugar do Claude Haiku.

## Comparação de modelos

| Modelo | TAMANHO | RAM | Melhor para |
|---|---|---|---|
| `llama3.1:8b` | 4.9 GB | ~8 GB | Uso geral (pedidos, cardápio) |
| `qwen2.5-coder:7b` | 4.7 GB | ~8 GB | Ajuda com código (ex: gerar SQL) |
| `qwen2.5-coder:32b` | 20 GB | ~24 GB | Melhor em código — rivaliza com GPT-4o |
| `mistral:7b` | 4.1 GB | ~8 GB | Alternativa open source geral |

## ⚠️ Limitações importantes

1. **Tool-calling fraco em modelos 8B**: Os modelos 8B locais têm dificuldade com as 3 tools
   (`search_produtos`, `get_order_hints`, `prepare_order_draft`). O chatbot pode
   falhar em encontrar produtos ou montar pedidos corretamente. Para uso real, use
   **Anthropic Haiku** ou **OpenAI GPT-5 mini**.

2. **Sem custo, mas com latência**: Modelos locais usam sua CPU/GPU — resposta mais
   lenta que APIs cloud (~5-30s vs ~1-3s).

3. **Não funciona em produção**: O Ollama não está disponível no Vercel. Se subir
   com `LLM_PROVIDER=ollama`, o chatbot vai dar erro. Mantenha `anthropic` ou
   `openai` para produção.

4. **Billing**: O custo de API (R$) é cobrado do `aiWallet` da empresa. Com Ollama,
   o custo é $0 por token — mas o uso ainda é debitado da carteira como R$ 0,00.

## Testes unitários com Ollama

Os testes em `npm test` usam mocks e não precisam do Ollama. Para smoke tests
manuais, configure `LLM_PROVIDER=ollama` e envie mensagens de teste.

## Parar / reiniciar o Ollama

```powershell
# Parar (libera RAM)
taskkill /IM ollama.exe /F

# Reiniciar
ollama serve
```

## Troubleshooting

**"Connection refused" ou "ECONNREFUSED"**
→ O Ollama não está rodando. Execute `ollama serve` em outro terminal.

**Respostas vazias ou ruins**
→ Normal para modelos 8B. Tente `qwen2.5-coder:32b` se tiver RAM suficiente.

**"ANTHROPIC_API_KEY missing"**
→ Confirme que `LLM_PROVIDER=ollama` está no `.env.local` e que você reiniciou o dev server.
