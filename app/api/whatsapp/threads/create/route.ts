import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

type Body = {
    phone_e164?: string;
    profile_name?: string;
};

function isValidE164(phone: string) {
    return /^\+\d{8,16}$/.test(phone.trim());
}

export async function POST(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { admin, companyId } = ctx;

    let body: Body = {};
    try {
        body = (await req.json()) as Body;
    } catch {
        return NextResponse.json({ error: "Body inválido (JSON)" }, { status: 400 });
    }

    const phone = (body.phone_e164 ?? "").trim();
    const profileName = (body.profile_name ?? "").trim();

    if (!phone) {
        return NextResponse.json({ error: "phone_e164 é obrigatório" }, { status: 400 });
    }
    if (!isValidE164(phone)) {
        return NextResponse.json(
            { error: "Telefone inválido. Use formato E.164, ex: +5565999999999" },
            { status: 400 }
        );
    }

    // Canal WhatsApp ativo da company (status = 'active')
    const { data: channel, error: chErr } = await admin
        .from("whatsapp_channels")
        .select("id")
        .eq("company_id", companyId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (chErr) return NextResponse.json({ error: chErr.message }, { status: 500 });
    if (!channel?.id) {
        return NextResponse.json({ error: "Nenhum canal WhatsApp ativo para esta empresa." }, { status: 400 });
    }

    // Idempotente: já existe thread para (company_id, phone_e164)?
    const { data: existing, error: exErr } = await admin
        .from("whatsapp_threads")
        .select("id, phone_e164, profile_name, last_message_at, last_message_preview, created_at")
        .eq("company_id", companyId)
        .eq("phone_e164", phone)
        .maybeSingle();

    if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });

    if (existing?.id) {
        // Opcional: se quiser atualizar nome quando vier no create
        if (profileName && existing.profile_name !== profileName) {
            await admin
                .from("whatsapp_threads")
                .update({ profile_name: profileName })
                .eq("id", existing.id);
        }
        return NextResponse.json({ thread: existing }, { status: 200 });
    }

    // Cria thread sem mensagem
    const { data: inserted, error: insErr } = await admin
        .from("whatsapp_threads")
        .insert({
            company_id: companyId,
            channel_id: channel.id,
            phone_e164: phone,
            profile_name: profileName || null,
            last_message_at: new Date().toISOString(), // para aparecer no topo
            last_message_preview: null,
        })
        .select("id, phone_e164, profile_name, last_message_at, last_message_preview, created_at")
        .single();

    if (insErr) {
        // corrida com índice único
        const code = (insErr as any)?.code;
        if (code === "23505") {
            const { data: again, error: againErr } = await admin
                .from("whatsapp_threads")
                .select("id, phone_e164, profile_name, last_message_at, last_message_preview, created_at")
                .eq("company_id", companyId)
                .eq("phone_e164", phone)
                .maybeSingle();

            if (againErr) return NextResponse.json({ error: againErr.message }, { status: 500 });
            if (again?.id) return NextResponse.json({ thread: again }, { status: 200 });
        }
        return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    return NextResponse.json({ thread: inserted }, { status: 201 });
}
