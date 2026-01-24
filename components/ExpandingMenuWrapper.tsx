// components/ExpandingMenuWrapper.tsx
"use client";

import React from "react";
import { usePathname } from "next/navigation";
import ExpandingMenu from "./ExpandingMenu";

export default function ExpandingMenuWrapper() {
    const pathname = usePathname();
    // se quiser esconder em outras rotas, inclua aqui
    if (pathname === "/login") return null;
    return <ExpandingMenu />;
}
