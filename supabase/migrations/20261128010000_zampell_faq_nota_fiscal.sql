-- O que o sistema faz, e que nota fiscal ainda não sai.
insert into public.service_faqs (company_id, question, answer, active)
select
  '0113a3fe-e224-49ff-81c6-f8b9df556267',
  v.question,
  v.answer,
  true
from (
  values
    (
      'O que o sistema faz?',
      'O sistema faz gestão de estoque, financeiro e entregador. A emissão de nota fiscal ainda não está disponível.'
    ),
    (
      'O sistema emite nota fiscal?',
      'Ainda não. O sistema faz gestão de estoque, financeiro e entregador. A emissão de nota fiscal não está disponível.'
    )
) as v(question, answer)
where not exists (
  select 1
  from public.service_faqs f
  where f.company_id = '0113a3fe-e224-49ff-81c6-f8b9df556267'
    and f.question = v.question
);
