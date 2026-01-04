Sumário das tabelas

brands · categories · companies · company_users · customers · feature_limits · features · order_items · orders · plan_features · plans · print_jobs · product_variants · products · subscription_addons · subscriptions · usage_monthly · v_daily_sales · v_whatsapp_usage_current_month · whatsapp_channels · whatsapp_contacts · whatsapp_messages · whatsapp_thread_reads · whatsapp_threads

Tabelas (detalhado)

Para cada coluna: ordinal_position, column_name, data_type, is_nullable, column_default.

brands

Colunas

id — uuid — NO — gen_random_uuid()

company_id — uuid — NO — —

name — text — NO — —

is_active — boolean — NO — true

created_at — timestamp with time zone — NO — now()

Constraints (fonte: constraints export) 

Supabase Snippet Add allow_over…

PK: brands_pkey — PRIMARY KEY (id)

FK: brands_company_id_fkey — FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE

UNIQUE: brands_company_id_name_key — UNIQUE (company_id, name)

categories

Colunas

id — uuid — NO — gen_random_uuid()

company_id — uuid — NO — —

name — text — NO — —

is_active — boolean — NO — true

created_at — timestamp with time zone — NO — now()

Constraints 

Supabase Snippet Add allow_over…

PK: categories_pkey — PRIMARY KEY (id)

FK: categories_company_id_fkey — FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE

UNIQUE: categories_company_id_name_key — UNIQUE (company_id, name)

companies

Colunas

id — uuid — NO — gen_random_uuid()

name — text — NO — —

city — text — YES — —

phone — text — YES — —

created_at — timestamp with time zone — NO — now()

delivery_fee_enabled — boolean — NO — false

default_delivery_fee — numeric — NO — 0

Constraints

PK: companies_pkey — PRIMARY KEY (id) 

Supabase Snippet Add allow_over…

company_users

Colunas

id — uuid — NO — gen_random_uuid()

company_id — uuid — NO — —

user_id — uuid — NO — —

role — text — NO — 'owner'::text

is_active — boolean — NO — true

created_at — timestamp with time zone — NO — now()

Constraints 

Supabase Snippet Add allow_over…

PK: company_users_pkey — PRIMARY KEY (id)

UNIQUE: company_users_company_id_user_id_key — UNIQUE (company_id, user_id)

FK: company_users_company_id_fkey — FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE

FK: company_users_user_id_fkey — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

CHECK: company_users_role_check — CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'staff'::text])))

customers

Colunas

id — uuid — NO — gen_random_uuid()

company_id — uuid — NO — —

phone — text — NO — —

name — text — YES — —

address — text — YES — —

address_ref — text — YES — —

neighborhood — text — YES — —

created_at — timestamp with time zone — NO — now()

Constraints 

Supabase Snippet Add allow_over…

PK: customers_pkey — PRIMARY KEY (id)

UNIQUE: customers_company_id_phone_key — UNIQUE (company_id, phone)

FK: customers_company_id_fkey — FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE

feature_limits

Colunas

plan_id — uuid — NO — —

feature_key — text — NO — —

limit_per_month — integer — NO — —

Constraints 

Supabase Snippet Add allow_over…

PK: feature_limits_pkey — PRIMARY KEY (plan_id, feature_key)

FK: feature_limits_plan_id_fkey — FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE

FK: feature_limits_feature_key_fkey — FOREIGN KEY (feature_key) REFERENCES features(key)

features

Colunas

key — text — NO — —

description — text — YES — —

Constraints

PK: features_pkey — PRIMARY KEY (key) 

Supabase Snippet Add allow_over…

order_items

Colunas

id — uuid — NO — gen_random_uuid()

order_id — uuid — NO — —

product_id — uuid — YES — —

product_name — text — YES — ''::text

unit_type — text — YES — —

quantity — integer — NO — —

unit_price — numeric — NO — 0

line_total — numeric — YES — —

created_at — timestamp with time zone — NO — now()

company_id — uuid — YES — —

product_variant_id — uuid — YES — —

qty — numeric — NO — 1

Observação: existem tanto quantity (integer) quanto qty (numeric) — possivelmente redundância; constraints referem quantity na checagem. Verificar se ambos são necessários ou se um é histórico.

Constraints 

Supabase Snippet Add allow_over…

PK: order_items_pkey — PRIMARY KEY (id)

FK: order_items_company_id_fkey — FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE

FK: order_items_order_id_fkey — FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE

FK: order_items_product_id_fkey — FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL

FK: order_items_product_variant_id_fkey — FOREIGN KEY (product_variant_id) REFERENCES product_variants(id) ON DELETE RESTRICT

CHECK: order_items_quantity_check — CHECK ((quantity > 0))

orders

Colunas

id — uuid — NO — gen_random_uuid()

company_id — uuid — NO — —

customer_id — uuid — YES — —

customer_phone — text — YES — —

customer_name — text — YES — —

delivery_address — text — YES — —

payment_method — text — YES — —

change_for — numeric — YES — —

notes — text — YES — —

total — numeric — NO — 0

status — text — NO — 'new'::text

channel — text — NO — 'whatsapp'::text

created_at — timestamp with time zone — NO — now()

printed_at — timestamp with time zone — YES — —

total_amount — numeric — NO — 0

paid — boolean — NO — false

delivery_fee — numeric — NO — 0

details — text — YES — —

Constraints 

Supabase Snippet Add allow_over…

PK: orders_pkey — PRIMARY KEY (id)

FK: orders_company_id_fkey — FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE

FK: orders_customer_id_fkey — FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL

CHECK: orders_channel_check — CHECK ((channel = ANY (ARRAY['whatsapp'::text, 'admin'::text])))

CHECK: orders_status_check — CHECK ((status = ANY (ARRAY['new'::text, 'canceled'::text, 'delivered'::text, 'finalized'::text])))

plan_features

Colunas

plan_id — uuid — NO — —

feature_key — text — NO — —

Constraints 

Supabase Snippet Add allow_over…

PK: plan_features_pkey — PRIMARY KEY (plan_id, feature_key)

FK: plan_features_plan_id_fkey — FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE

FK: plan_features_feature_key_fkey — FOREIGN KEY (feature_key) REFERENCES features(key) ON DELETE CASCADE

plans

Colunas

id — uuid — NO — gen_random_uuid()

key — text — NO — —

name — text — NO — —

description — text — YES — —

created_at — timestamp with time zone — NO — now()

Constraints 

Supabase Snippet Add allow_over…

PK: plans_pkey — PRIMARY KEY (id)

UNIQUE: plans_key_key — UNIQUE (key)

print_jobs

Colunas

id — uuid — NO — gen_random_uuid()

company_id — uuid — NO — —

order_id — uuid — YES — —

status — USER-DEFINED — NO — 'pending'::job_status

payload — jsonb — YES — —

error — text — YES — —

created_at — timestamp with time zone — NO — now()

processed_at — timestamp with time zone — YES — —

Constraints 

Supabase Snippet Add allow_over…

PK: print_jobs_pkey — PRIMARY KEY (id)

FK: print_jobs_company_id_fkey — FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE

FK: print_jobs_order_id_fkey — FOREIGN KEY (order_id) REFERENCES orders(id)

product_variants

Colunas

id — uuid — NO — gen_random_uuid()

company_id — uuid — NO — —

product_id — uuid — NO — —

volume_value — numeric — YES — —

(posição 5 ausente na export)

unit_price — numeric — NO — 0

has_case — boolean — NO — false

case_qty — integer — YES — —

case_price — numeric — YES — —

is_active — boolean — NO — true

created_at — timestamp with time zone — NO — now()

unit — text — YES — 'none'::text

details — text — YES — —

Observação: A export pulou ordinal_position 5 — confirmar no banco se existe uma coluna adicional entre volume_value e unit_price.

Constraints 

Supabase Snippet Add allow_over…

PK: product_variants_pkey — PRIMARY KEY (id)

FK: product_variants_company_id_fkey — FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE

FK: product_variants_product_id_fkey — FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE

CHECK: product_variants_unit_check — CHECK ((unit = ANY (ARRAY['none'::text, 'ml'::text, 'l'::text, 'kg'::text])))

products

Colunas

id — uuid — NO — gen_random_uuid()

company_id — uuid — NO — —

name — text — NO — —

category — text — YES — —

unit_type — text — NO — 'unidade'::text

price — numeric — NO — 0

is_active — boolean — NO — true

sku — text — YES — —

created_at — timestamp with time zone — NO — now()

category_id — uuid — YES — —

brand_id — uuid — YES — —

details — text — YES — —

Constraints 

Supabase Snippet Add allow_over…

PK: products_pkey — PRIMARY KEY (id)

FK: products_company_id_fkey — FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE

FK: products_category_id_fkey — FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL

FK: products_brand_id_fkey — FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL

subscription_addons

Colunas

id — uuid — NO — gen_random_uuid()

company_id — uuid — NO — —

feature_key — text — NO — —

quantity — integer — NO — 1

created_at — timestamp with time zone — NO — now()

Constraints 

Supabase Snippet Add allow_over…

PK: subscription_addons_pkey — PRIMARY KEY (id)

UNIQUE: subscription_addons_company_id_feature_key_key — UNIQUE (company_id, feature_key)

FK: subscription_addons_company_id_fkey — FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE

FK: subscription_addons_feature_key_fkey — FOREIGN KEY (feature_key) REFERENCES features(key)

subscriptions

Colunas

id — uuid — NO — gen_random_uuid()

company_id — uuid — NO — —

plan_id — uuid — NO — —

status — text — NO — 'active'::text

started_at — timestamp with time zone — NO — now()

ended_at — timestamp with time zone — YES — —

allow_overage — boolean — NO — false

Constraints 

Supabase Snippet Add allow_over…

PK: subscriptions_pkey — PRIMARY KEY (id)

FK: subscriptions_company_id_fkey — FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE

FK: subscriptions_plan_id_fkey — FOREIGN KEY (plan_id) REFERENCES plans(id)

usage_monthly

Colunas

id — uuid — NO — gen_random_uuid()

company_id — uuid — NO — —

feature_key — text — NO — —

year_month — text — NO — —

used — integer — NO — 0

created_at — timestamp with time zone — NO — now()

Constraints 

Supabase Snippet Add allow_over…

PK: usage_monthly_pkey — PRIMARY KEY (id)

UNIQUE: usage_monthly_company_id_feature_key_year_month_key — UNIQUE (company_id, feature_key, year_month)

FK: usage_monthly_company_id_fkey — FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE

v_daily_sales (view)

Colunas (view)

company_id — uuid — YES

day — timestamp with time zone — YES

orders_count — bigint — YES

gross_total — numeric — YES

delivered_total — numeric — YES

Observação: view — definição não incluída no export. Se desejar, envio query para extrair view_definition.

v_whatsapp_usage_current_month (view)

Colunas (view)

company_id — uuid — YES

company_name — text — YES

messages_used — integer — YES

limit_per_month — integer — YES

overage — integer — YES

whatsapp_channels

Colunas

id — uuid — NO — gen_random_uuid()

company_id — uuid — NO — —

provider — USER-DEFINED — NO — —

status — USER-DEFINED — NO — 'active'::whatsapp_channel_status

from_identifier — text — NO — —

provider_metadata — jsonb — YES — —

started_at — timestamp with time zone — NO — now()

ended_at — timestamp with time zone — YES — —

created_at — timestamp with time zone — NO — now()

Constraints 

Supabase Snippet Add allow_over…

PK: whatsapp_channels_pkey — PRIMARY KEY (id)

FK: whatsapp_channels_company_id_fkey — FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE

UNIQUE: one_active_channel_per_company — UNIQUE (company_id) DEFERRABLE INITIALLY DEFERRED
(nota: constraint deferrable — provavelmente garante 1 canal ativo por company com lógica adicional no app/trigger)

whatsapp_contacts

Colunas

id — uuid — NO — gen_random_uuid()

company_id — uuid — NO — —

phone_e164 — text — NO — —

display_name — text — YES — —

created_at — timestamp with time zone — NO — now()

Constraints 

Supabase Snippet Add allow_over…

PK: whatsapp_contacts_pkey — PRIMARY KEY (id)

FK: whatsapp_contacts_company_id_fkey — FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE

UNIQUE: whatsapp_contacts_company_id_phone_e164_key — UNIQUE (company_id, phone_e164)

whatsapp_messages

Colunas

id — uuid — NO — gen_random_uuid()

thread_id — uuid — NO — —

direction — text — NO — —

channel — text — NO — 'whatsapp'::text

twilio_message_sid — text — YES — —

twilio_account_sid — text — YES — —

from_addr — text — NO — —

to_addr — text — NO — —

body — text — YES — —

num_media — integer — NO — 0

raw_payload — jsonb — YES — —

created_at — timestamp with time zone — NO — now()

provider — USER-DEFINED — YES — —

provider_message_id — text — YES — —

status — text — YES — —

error — text — YES — —

Constraints 

Supabase Snippet Add allow_over…

PK: whatsapp_messages_pkey — PRIMARY KEY (id)

FK: whatsapp_messages_thread_id_fkey — FOREIGN KEY (thread_id) REFERENCES whatsapp_threads(id) ON DELETE CASCADE

CHECK: whatsapp_messages_direction_check — CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text])))

whatsapp_thread_reads

Colunas

id — uuid — NO — gen_random_uuid()

company_id — uuid — NO — —

user_id — uuid — NO — —

thread_id — uuid — NO — —

last_read_at — timestamp with time zone — NO — now()

created_at — timestamp with time zone — NO — now()

updated_at — timestamp with time zone — NO — now()

Constraints 

Supabase Snippet Add allow_over…

PK: whatsapp_thread_reads_pkey — PRIMARY KEY (id)

FK: whatsapp_thread_reads_company_id_fkey — FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE

FK: whatsapp_thread_reads_thread_id_fkey — FOREIGN KEY (thread_id) REFERENCES whatsapp_threads(id) ON DELETE CASCADE

FK: whatsapp_thread_reads_user_id_fkey — FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

whatsapp_threads

Colunas

id — uuid — NO — gen_random_uuid()

phone_e164 — text — NO — —

wa_from — text — YES — —

wa_to — text — YES — —

profile_name — text — YES — —

last_message_at — timestamp with time zone — YES — —

created_at — timestamp with time zone — NO — now()

company_id — uuid — NO — —

channel_id — uuid — NO — —

last_message_preview — text — YES — —

Constraints 

Supabase Snippet Add allow_over…

PK: whatsapp_threads_pkey — PRIMARY KEY (id)

FK: whatsapp_threads_company_id_fkey — FOREIGN KEY (company_id) REFERENCES companies(id)

FK: whatsapp_threads_channel_id_fkey — FOREIGN KEY (channel_id) REFERENCES whatsapp_channels(id)

UNIQUE: whatsapp_threads_phone_e164_key — UNIQUE (phone_e164)