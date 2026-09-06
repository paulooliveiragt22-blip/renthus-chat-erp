import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Zampell Delivery — Agentes inteligentes para o seu delivery",
    description:
        "O WhatsApp do seu delivery atende e anota o pedido? O nosso sim. Conheça o agente de IA que atende, anota e imprime o pedido na hora.",
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
    return children;
}
