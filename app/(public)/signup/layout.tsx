import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Zampell Delivery — Agentes inteligentes para o seu delivery",
    description:
        "O WhatsApp do seu delivery atende e anota o pedido. Você só confirma e manda sair. Só WhatsApp — sem Instagram ou Messenger.",
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
    return children;
}
