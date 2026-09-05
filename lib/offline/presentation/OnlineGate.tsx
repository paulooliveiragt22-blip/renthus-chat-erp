"use client";

/**
 * Gate para superfícies online-only (billing, etc.). P0: só o componente.
 */

import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import {
    getSyncStatusSnapshot,
    subscribeSyncStatus,
} from "../syncStatusStore";

export function OnlineGate({
    children,
    fallback,
}: {
    children: ReactNode;
    fallback?: ReactNode;
}) {
    const online = useSyncExternalStore(
        subscribeSyncStatus,
        () => getSyncStatusSnapshot().online,
        () => true
    );

    if (!online) {
        return (
            <>
                {fallback ?? (
                    <p className="text-sm text-zinc-500">
                        Esta ação exige conexão com a internet.
                    </p>
                )}
            </>
        );
    }

    return <>{children}</>;
}
