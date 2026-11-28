import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { ClosingBand } from "@/components/marketing/ClosingBand";
import { Faq } from "@/components/marketing/Faq";
import { FeatureChapters } from "@/components/marketing/FeatureChapters";
import { Hero } from "@/components/marketing/Hero";
import { LandingReveal } from "@/components/marketing/LandingReveal";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { PlanShowcase } from "@/components/marketing/PlanShowcase";
import { SiteChat } from "@/components/marketing/SiteChat";
import { SiteVisitBeacon } from "@/components/marketing/SiteVisitBeacon";
import { StickySignupCta } from "@/components/marketing/StickySignupCta";
import { UseCaseList } from "@/components/marketing/UseCaseList";

const inter = Inter({ subsets: ["latin"], variable: "--font-landing-body" });
const jakarta = Plus_Jakarta_Sans({
    subsets: ["latin"],
    variable: "--font-landing-display",
});

type MarketingHomeProps = {
    linkToApp?: boolean;
    siteChat?: {
        publicKey: string;
        companyName: string;
        replies: string[];
    } | null;
};

export function MarketingHome({ linkToApp = false, siteChat = null }: MarketingHomeProps) {
    return (
        <div
            className={`${inter.variable} ${jakarta.variable} min-h-screen scroll-smooth bg-white pb-28 font-[family-name:var(--font-landing-body)] text-slate-950 md:pb-0`}
        >
            <MarketingHeader linkToApp={linkToApp} />
            <main>
                <Hero linkToApp={linkToApp} />
                <LandingReveal>
                    <PlanShowcase linkToApp={linkToApp} beforeSavings={<FeatureChapters />}>
                        <UseCaseList />
                    </PlanShowcase>
                </LandingReveal>
                <LandingReveal>
                    <Faq />
                </LandingReveal>
                <ClosingBand linkToApp={linkToApp} />
            </main>
            <MarketingFooter linkToApp={linkToApp} />
            <StickySignupCta linkToApp={linkToApp} />
            <SiteVisitBeacon />
            <SiteChat
                publicKey={siteChat?.publicKey}
                companyName={siteChat?.companyName}
                replies={siteChat?.replies}
            />
        </div>
    );
}
