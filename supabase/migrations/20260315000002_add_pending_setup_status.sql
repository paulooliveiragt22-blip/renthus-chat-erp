-- Adiciona status 'pending_setup' ao enum pagarme_sub_status
-- Representa empresas que iniciaram o processo de contratação
-- mas ainda não tiveram o setup aprovado.
ALTER TYPE pagarme_sub_status ADD VALUE IF NOT EXISTS 'pending_setup';
