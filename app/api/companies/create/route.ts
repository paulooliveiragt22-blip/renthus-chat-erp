// app/api/companies/create/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing Supabase env vars for service role.');
}

// Cria cliente admin (service role)
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
});

type Body = {
    name: string;
    slug?: string;
    email?: string;
    phone?: string;
    whatsapp_phone?: string;
    meta?: Record<string, any>;
    settings?: Record<string, any>;
    user_id?: string; // uuid do usuário criador - melhor passar pelo backend/autorização
};

export async function POST(req: NextRequest) {
    try {
        const body: Body = await req.json();

        if (!body?.name) {
            return NextResponse.json({ error: 'O campo name é obrigatório' }, { status: 400 });
        }

        // user_id: se estiver usando autenticação via JWT, você pode pegar do header Authorization,
        // mas como estamos usando service role, pedimos que o front envie o user_id do criador.
        const creatorUserId = body.user_id;
        if (!creatorUserId) {
            return NextResponse.json({ error: 'user_id do criador é obrigatório' }, { status: 400 });
        }

        // Inserir company
        const { data: companyData, error: companyError } = await supabaseAdmin
            .from('companies')
            .insert([{
                name: body.name,
                slug: body.slug ?? null,
                email: body.email ?? null,
                phone: body.phone ?? null,
                whatsapp_phone: body.whatsapp_phone ?? null,
                meta: body.meta ?? {},
                settings: body.settings ?? {},
                is_active: true
            }])
            .select('*')
            .limit(1)
            .single();

        if (companyError) {
            console.error('Erro criando company:', companyError);
            return NextResponse.json({ error: 'Erro criando empresa' }, { status: 500 });
        }

        const company_id = companyData.id;

        // Inserir vínculo company_users (owner)
        const { data: cuData, error: cuError } = await supabaseAdmin
            .from('company_users')
            .insert([{
                company_id,
                user_id: creatorUserId,
                role: 'owner',
                is_active: true
            }])
            .select('*')
            .limit(1)
            .single();

        if (cuError) {
            console.error('Erro criando company_user:', cuError);
            // opcional: remover company criada em caso de falha no vínculo
            await supabaseAdmin.from('companies').delete().eq('id', company_id);
            return NextResponse.json({ error: 'Erro vinculando usuário à empresa' }, { status: 500 });
        }

        // Retorna a company com o vínculo do owner (resposta simples)
        return NextResponse.json({
            company: companyData,
            company_user: cuData
        }, { status: 201 });

    } catch (err) {
        console.error('Erro no endpoint companies/create:', err);
        return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
    }
}
