"use client";

import { useEffect } from "react";

export function SiteVisitBeacon() {
    useEffect(() => {
        void fetch("/api/public/site-visit", {
            method: "POST",
            credentials: "include",
            cache: "no-store",
        });
    }, []);
    return null;
}
