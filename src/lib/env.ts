import { z } from "zod";

type SupabaseEnv = {
    NEXT_PUBLIC_SUPABASE_URL: string;
    NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
};

const publicEnvSchema = z.object({
    NEXT_PUBLIC_SUPABASE_URL: z.string().url({ message: "NEXT_PUBLIC_SUPABASE_URL must be a valid URL" }),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
});

const serviceRoleSchema = z.object({
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
});

function readPublicEnv() {
    return publicEnvSchema.parse({
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    });
}

function readServiceRoleKey() {
    if (typeof window !== "undefined") {
        throw new Error("SUPABASE_SERVICE_ROLE_KEY is only available on the server");
    }

    return serviceRoleSchema.parse({ SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY })
        .SUPABASE_SERVICE_ROLE_KEY;
}

export function loadSupabaseEnv(): SupabaseEnv {
    const publicEnv = readPublicEnv();
    const serviceRoleKey = readServiceRoleKey();

    return {
        ...publicEnv,
        SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    } satisfies SupabaseEnv;
}

export const supabasePublicEnv = (() => {
    const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = readPublicEnv();
    return { url: NEXT_PUBLIC_SUPABASE_URL, anonKey: NEXT_PUBLIC_SUPABASE_ANON_KEY };
})();

export function getSupabaseServiceRoleKey() {
    return readServiceRoleKey();
}

export const supabaseEnv = {
    get NEXT_PUBLIC_SUPABASE_URL() {
        return supabasePublicEnv.url;
    },
    get NEXT_PUBLIC_SUPABASE_ANON_KEY() {
        return supabasePublicEnv.anonKey;
    },
    get SUPABASE_SERVICE_ROLE_KEY() {
        return getSupabaseServiceRoleKey();
    },
};

export type { SupabaseEnv };
