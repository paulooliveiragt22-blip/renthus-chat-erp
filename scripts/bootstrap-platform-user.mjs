#!/usr/bin/env node
/**
 * Bootstrap platform user linked to Supabase Auth.
 *
 * Usage:
 *   node scripts/bootstrap-platform-user.mjs --email ops@renthus.com.br --role superadmin --name "Ops"
 *   node scripts/bootstrap-platform-user.mjs --email ops@renthus.com.br --password "SenhaForte123!"
 *   node scripts/bootstrap-platform-user.mjs --email ops@renthus.com.br --resend-invite
 *
 * Carrega automaticamente `.env.local` da raiz do projeto.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnvLocal() {
    const p = resolve(process.cwd(), ".env.local");
    let raw;
    try {
        raw = readFileSync(p, "utf8");
    } catch {
        return;
    }
    for (const line of raw.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const idx = t.indexOf("=");
        if (idx <= 0) continue;
        const key = t.slice(0, idx).trim();
        let val = t.slice(idx + 1).trim();
        if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
        ) {
            val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
    }
}

loadDotEnvLocal();

function parseArgs(argv) {
    const out = {
        email: "",
        role: "superadmin",
        name: "",
        password: "",
        resendInvite: false,
    };
    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === "--email") out.email = argv[++i] ?? "";
        else if (argv[i] === "--role") out.role = argv[++i] ?? "superadmin";
        else if (argv[i] === "--name") out.name = argv[++i] ?? "";
        else if (argv[i] === "--password") out.password = argv[++i] ?? "";
        else if (argv[i] === "--resend-invite") out.resendInvite = true;
    }
    return out;
}

function appOrigin() {
    return (
        process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
        process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
        "http://localhost:3000"
    );
}

function inviteRedirectTo() {
    const next = encodeURIComponent("/auth/set-password?next=/platform/login");
    return `${appOrigin()}/auth/callback?next=${next}`;
}

const { email, role, name, password, resendInvite } = parseArgs(process.argv);
if (!email) {
    console.error(
        "Usage: node scripts/bootstrap-platform-user.mjs --email x@domain [--role superadmin] [--name Display] [--password Senha] [--resend-invite]"
    );
    process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
    console.error(
        "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
            "Confirme que existem em .env.local na raiz do projeto."
    );
    process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false } });

const { data: list, error: listErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
});
if (listErr) {
    console.error(listErr.message);
    process.exit(1);
}

let authUser = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
const redirectTo = inviteRedirectTo();

if (!authUser) {
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
        email,
        {
            redirectTo,
            data: { platform_bootstrap: true, platform_role: role },
        }
    );
    if (inviteErr) {
        console.error("invite failed:", inviteErr.message);
        process.exit(1);
    }
    authUser = invited.user;
    console.log("Invited auth user:", authUser.id);
    console.log("Invite redirectTo:", redirectTo);
} else {
    console.log("Found auth user:", authUser.id);
    if (resendInvite) {
        const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
            type: "invite",
            email,
            options: { redirectTo },
        });
        if (linkErr) {
            console.error("generateLink failed:", linkErr.message);
            process.exit(1);
        }
        console.log("Novo link de convite (abra no browser):");
        console.log(link.properties?.action_link ?? link);
    }
}

if (password) {
    if (password.length < 8) {
        console.error("--password deve ter pelo menos 8 caracteres");
        process.exit(1);
    }
    const { error: pwErr } = await admin.auth.admin.updateUserById(authUser.id, {
        password,
        email_confirm: true,
    });
    if (pwErr) {
        console.error("set password failed:", pwErr.message);
        process.exit(1);
    }
    console.log("Senha definida via admin. Pode entrar em /platform/login");
}

const displayName = name || email.split("@")[0];
const mfaRequired = role === "superadmin" || role === "ops";

const { data: row, error: upsertErr } = await admin
    .from("platform_users")
    .upsert(
        {
            auth_user_id: authUser.id,
            email,
            display_name: displayName,
            role,
            is_active: true,
            mfa_required: mfaRequired,
            updated_at: new Date().toISOString(),
        },
        { onConflict: "auth_user_id" }
    )
    .select("id, email, role")
    .single();

if (upsertErr) {
    console.error(upsertErr.message);
    process.exit(1);
}

console.log("platform_users OK:", row);
if (!password && !resendInvite) {
    console.log(
        "\nDica: se o e-mail de convite só abriu /login, rode com --password \"SuaSenha123\" para liberar o acesso agora, ou --resend-invite para gerar link certo."
    );
}
