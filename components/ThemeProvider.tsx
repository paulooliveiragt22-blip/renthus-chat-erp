"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ThemeProviderProps } from "next-themes";

/**
 * Wrapper fino sobre next-themes.
 * Usa `attribute="class"` para adicionar/remover a classe `.dark` no <html>,
 * compatível com @custom-variant dark no Tailwind v4.
 */
export default function ThemeProvider({ children, ...props }: ThemeProviderProps) {
    return (
        <NextThemesProvider
            attribute="class"
            defaultTheme="light"
            enableSystem={false}
            storageKey="renthus-theme"
            {...props}
        >
            {children}
        </NextThemesProvider>
    );
}
