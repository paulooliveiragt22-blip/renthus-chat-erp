import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPublicMenuBySlug } from "@/lib/public-menu/loadPublicMenu";
import { parseMenuSlug } from "@/lib/public-menu/slug";
import MenuClient from "./MenuClient";

export const runtime = "nodejs";
export const revalidate = 60;

type PageProps = {
    params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { slug } = await params;
    const parsed = parseMenuSlug(slug);
    if (!parsed.ok) return { title: "Cardápio" };
    try {
        const admin = createAdminClient();
        const result = await loadPublicMenuBySlug(admin, parsed.slug);
        if (!result.ok) return { title: "Cardápio" };
        return {
            title: `${result.menu.store.displayName} · Cardápio`,
            description: result.menu.store.tagline ?? `Cardápio de ${result.menu.store.displayName}`,
        };
    } catch {
        return { title: "Cardápio" };
    }
}

export default async function PublicMenuPage({ params }: PageProps) {
    const { slug } = await params;
    const parsed = parseMenuSlug(slug);
    if (!parsed.ok) {
        return <MenuUnavailable title="Cardápio não encontrado" />;
    }

    let result;
    try {
        const admin = createAdminClient();
        result = await loadPublicMenuBySlug(admin, parsed.slug);
    } catch {
        return <MenuUnavailable title="Cardápio indisponível" hint="Tente novamente em instantes." />;
    }

    if (!result.ok) {
        if (result.error === "menu_inactive") {
            return <MenuUnavailable title="Cardápio temporariamente offline" />;
        }
        return <MenuUnavailable title="Cardápio não encontrado" />;
    }

    return <MenuClient menu={result.menu} />;
}

function MenuUnavailable({ title, hint }: { title: string; hint?: string }) {
    return (
        <div className="flex min-h-dvh flex-col items-center justify-center bg-[#f6f3ee] px-6 text-center">
            <p className="text-lg font-semibold text-zinc-900">{title}</p>
            {hint ? <p className="mt-2 text-sm text-zinc-500">{hint}</p> : null}
        </div>
    );
}
