# Renthus Chat + ERP — Project Spec (Fonte de Verdade)

## Objetivo
Entregar um produto multi-tenant (SaaS) onde cada `company` é um cliente pagante do Renthus, com:
- Mini-ERP ou ERP completo (dependendo do plano)
- Canal WhatsApp com roteamento por provedor (Twilio ou 360dialog), com migração total quando fizer sentido financeiro/operacional
- (Add-on) impressão automática

## Premissas de negócio
1) Cada `company` é um tenant e um cliente pagante.
2) Cada company tem **um canal WhatsApp ativo por vez** (um número + um provedor).
3) Provedores:
   - Baixa demanda -> Twilio (pay-per-use)
   - Alta demanda -> 360dialog (custo previsível e menor por volume)
4) Migração:
   - Picos sazonais NÃO causam migração
   - Se volume alto for consistente (ex: 2 de 3 meses ou 3 meses seguidos acima do limite), migração total para 360dialog
5) “Um mesmo usuário não fica com o mesmo número em Twilio e 360dialog”:
   - canal antigo é encerrado/migrado; canal novo entra ativo.

## Stack / execução
- Front: Next.js (App Router)
- Backend: Next.js Route Handlers em `app/api/...`
- Banco: Supabase Postgres (multi-tenant por `company_id`)
- Segurança:
  - UI chama `app/api/...`
  - Backend acessa Supabase com **Service Role**
  - Evitar depender de RLS no front (reduz risco e complexidade)

## Estado atual do banco (resumo)
Tabelas principais em `public`:
- companies, company_users
- customers, orders, order_items
- products, product_variants, categories, brands
- whatsapp_threads, whatsapp_messages
- view: v_daily_sales

RLS:
- whatsapp_threads e whatsapp_messages com RLS ligado, mas sem policies (acesso precisa ser via service role)

## Objetivos técnicos imediatos
1) Consolidar documentação e decisões (ADR)
2) Evoluir modelo WhatsApp para:
   - multi-tenant (ligado a company)
   - multi-provider (Twilio + 360dialog)
   - deduplicação e auditoria
3) Implementar “entitlements” de planos + limites + medição de uso (mensagens/mês)
4) Desenhar pipeline de impressão automática (fila de print jobs)

## Convenções
- Todas as entidades multi-tenant devem ter `company_id` ou apontar para algo que tenha `company_id`.
- Todas as operações sensíveis (envio WhatsApp, impressão, billing) passam pelo backend (`app/api/...`).
