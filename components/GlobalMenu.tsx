"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
    { href: "/whatsapp", label: "WhatsApp" },
    { href: "/pedidos", label: "Pedidos" },
    { href: "/produtos", label: "Produtos" },
    { href: "/produtos/lista", label: "Lista de produtos" },
];

export default function GlobalMenu() {
    const pathname = usePathname();
    const hideMenu = pathname === "/login";

    if (hideMenu) return null;

    return (
        <header
            style={{
                position: "sticky",
                top: 0,
                zIndex: 20,
                background: "#fff",
                borderBottom: "1px solid #ece7f5",
                padding: "10px 16px",
                display: "flex",
                alignItems: "center",
                gap: 16,
            }}
        >
            <div style={{ fontWeight: 800, fontSize: 16, color: "#3B246B" }}>Disk Bebidas</div>

            <nav style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {links.map((link) => (
                    <Link
                        key={link.href}
                        href={link.href}
                        style={{
                            padding: "8px 12px",
                            borderRadius: 10,
                            border: "1px solid #e5ddf3",
                            background: "#f7f4fb",
                            color: "#2f2442",
                            fontWeight: 700,
                            fontSize: 13,
                            textDecoration: "none",
                        }}
                    >
                        {link.label}
                    </Link>
                ))}
            </nav>

            <div style={{ marginLeft: "auto" }}>
                <Link
                    href="/login"
                    style={{
                        padding: "6px 10px",
                        borderRadius: 8,
                        border: "1px solid #e5ddf3",
                        color: "#6b5a87",
                        fontWeight: 700,
                        textDecoration: "none",
                        fontSize: 12,
                        background: "#faf8fd",
                    }}
                >
                    Sair
                </Link>
            </div>
        </header>
    );
}
