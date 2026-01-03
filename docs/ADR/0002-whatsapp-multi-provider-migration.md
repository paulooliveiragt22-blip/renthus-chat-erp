# ADR-0002 — WhatsApp multi-provider com migração total por company

## Status
Aceito

## Contexto
Objetivo comercial:
- low volume: Twilio (paga por uso)
- high volume: 360dialog (previsível/mais barato)
- migração apenas quando volume alto for consistente
- um mesmo usuário não mantém o mesmo número em ambos

## Decisão
Modelar WhatsApp por "canal":
- `company` possui 1 canal ativo por vez
- canal define: provedor + número
- migração: encerra canal antigo (migrated) e ativa novo canal

Manter dois webhooks:
- Twilio inbound (form-data/TwiML)
- 360dialog inbound (JSON)

Unificar armazenamento:
- threads/messages no mesmo banco
- deduplicação por (provider, provider_message_id)
- sempre salvar raw payload para auditoria/debug

## Consequências
- A UI e o backend sempre operam por company/channel
- O envio é um dispatcher que escolhe o provedor pelo canal ativo
- Billing/limits decidem quando sugerir migração
