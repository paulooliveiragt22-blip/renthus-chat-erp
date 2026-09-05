"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/useWorkspace";
import {
    initMixpanel,
    isMixpanelEnabled,
    mixpanelIdentify,
    trackAppOpened,
} from "@/lib/analytics/mixpanelBrowser";

/**
 * Init Mixpanel (doc Next.js) + identify + app_opened para Live View.
 * https://docs.mixpanel.com/docs/tracking-methods/integrations/nextjs
 */
export function MixpanelBootstrap() {
    const { currentCompanyId } = useWorkspace();
    const openedRef = useRef(false);

    useEffect(() => {
        if (!isMixpanelEnabled()) {
            if (process.env.NODE_ENV === "development") {
                console.warn(
                    "[mixpanel] token ausente no bundle. Confirme NEXT_PUBLIC_MIXPANEL_TOKEN e reinicie o next dev / redeploy."
                );
            }
            return;
        }
        initMixpanel();

        const supabase = createClient();
        let cancelled = false;

        async function syncIdentity() {
            const { data } = await supabase.auth.getSession();
            const user = data.session?.user;
            if (cancelled || !user) return;
            mixpanelIdentify(user.id, {
                email: user.email ?? null,
                name:
                    typeof user.user_metadata?.full_name === "string"
                        ? user.user_metadata.full_name
                        : null,
                company_id: currentCompanyId,
            });
            if (!openedRef.current) {
                openedRef.current = true;
                trackAppOpened(currentCompanyId);
            }
        }

        void syncIdentity();

        const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === "SIGNED_OUT") return;
            const user = session?.user;
            if (!user) return;
            mixpanelIdentify(user.id, {
                email: user.email ?? null,
                company_id: currentCompanyId,
            });
        });

        return () => {
            cancelled = true;
            sub.subscription.unsubscribe();
        };
    }, [currentCompanyId]);

    return null;
}
