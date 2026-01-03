# Planos e Cobrança — Renthus Chat + ERP

## Identidade do cliente pagante
Cliente pagante = `company` (tenant).

## Planos base (primeira versão)
### Plano 1: Chatbot + Mini-ERP
Inclui:
- Pedidos (orders), clientes (customers) e catálogo básico (products)
- Atendimento WhatsApp (por canal) com provedor definido por contrato
- Limites de mensagens mensais (contrato)

Restrições (exemplos):
- recursos avançados do ERP desabilitados por feature flags
- menos usuários internos / menos filiais (se aplicável)

### Plano 2: Chatbot + ERP Completo
Inclui tudo do Mini-ERP e libera features avançadas:
- mais perfis internos
- relatórios mais completos
- automações
- integrações adicionais

## Add-ons (independentes do plano)
### Add-on: Impressão automática
- habilita fila de impressão para pedidos/OS
- cobrança fixa mensal ou por unidade (definir)

## Estratégia WhatsApp (Twilio x 360dialog)
Regra:
- Baixa demanda -> Twilio (pay-per-use)
- Alta demanda -> 360dialog (previsível e menor custo por volume)
- Picos sazonais não geram migração automaticamente
- Se uso alto for consistente, migração total de canal (novo número/provedor)

## Limites e overage (excesso)
- Cada plano define limite mensal de mensagens (in + out)
- Excesso:
  - mantém no Twilio
  - cobra adicional conforme contrato
  - marca company para análise de migração se recorrente

## Métrica de uso
- consolidar `usage_monthly` por company e feature (ex: whatsapp_messages)
- permitir auditoria e export para financeiro

