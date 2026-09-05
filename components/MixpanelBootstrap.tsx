"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/useWorkspace";
import {
    initMixpanel,
    isMixpanelEnabled,
    mixpanelIdentify,
} from "@/lib/analytics/mixpanelBrowser";

/**
 * Init Mixpanel once + identify on session (login / page reopen).
 */
export function MixpanelBootstrap() {
    const { currentCompanyId } = useWorkspace();

    useEffect(() => {
        if (!isMixpanelEnabled()) return;
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
