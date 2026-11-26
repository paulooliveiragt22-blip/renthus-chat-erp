import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteChat } from "@/components/marketing/SiteChat";
import { createAdminClient } from "@/lib/supabase/admin";
import { readSiteChatPublic } from "@/src/service/adapters/site/siteChatRpc";

export const metadata: Metadata = {
    title: "Chat",
    robots: { index: false, follow: false },
};

export default async function CompanyChatPage({ params }: { params: Promise<{ key: string }> }) {
    const { key } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(key)) {
        notFound();
    }
    let profile = null;
    try {
        profile = await readSiteChatPublic(createAdminClient(), key);
    } catch (error: unknown) {
        console.warn("[site-chat] page", error instanceof Error ? error.message : "failed");
        profile = null;
    }
    if (!profile) notFound();
    return (
        <SiteChat
            presentation="page"
            publicKey={key}
            companyName={profile.companyName}
            replies={profile.replies}
        />
    );
}
