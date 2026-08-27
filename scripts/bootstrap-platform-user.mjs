#!/usr/bin/env node
/**
 * Bootstrap platform user linked to Supabase Auth.
 * Usage: node scripts/bootstrap-platform-user.mjs --email ops@renthus.com.br --role superadmin --name "Ops Renthus"
 */
import { createClient } from "@supabase/supabase-js";

function parseArgs(argv) {
    const out = { email: "", role: "superadmin", name: "" };
    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === "--email") out.email = argv[++i] ?? "";
        else if (argv[i] === "--role") out.role = argv[++i] ?? "superadmin";
        else if (argv[i] === "--name") out.name = argv[++i] ?? "";
    }
    return out;
}

const { email, role, name } = parseArgs(process.argv);
if (!email) {
    console.error("Usage: node scripts/bootstrap-platform-user.mjs --email x@domain --role superadmin [--name Display]");
    process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false } });

const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (listErr) {
    console.error(listErr.message);
    process.exit(1);
}

let authUser = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

if (!authUser) {
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email);
    if (inviteErr) {
        console.error("invite failed:", inviteErr.message);
        process.exit(1);
    }
    authUser = invited.user;
    console.log("Invited auth user:", authUser.id);
} else {
    console.log("Found auth user:", authUser.id);
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
