import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type Mock, vi } from "vitest";

import LoginPage from "@/app/login/LoginClient";

const mockRouter = {
    replace: vi.fn(),
    refresh: vi.fn(),
};

let params = new URLSearchParams();

const authMock = {
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    resetPasswordForEmail: vi.fn(),
};

vi.mock("next/navigation", () => ({
    useRouter: () => mockRouter,
    useSearchParams: () => params,
}));

vi.mock("@/lib/supabase/client", () => ({
    createClient: () => ({ auth: authMock }),
}));

describe("LoginPage", () => {
    beforeEach(() => {
        params = new URLSearchParams();
        mockRouter.replace.mockReset();
        mockRouter.refresh.mockReset();
        authMock.signInWithPassword.mockReset();
        authMock.signUp.mockReset();
        authMock.resetPasswordForEmail.mockReset();
        vi.stubGlobal("fetch", vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("logs in and redirects when credentials are valid", async () => {
        authMock.signInWithPassword.mockResolvedValue({ error: null });
        const fetchMock = fetch as unknown as Mock;
        fetchMock
            .mockResolvedValueOnce({ ok: true, json: async () => ({ companies: [{ id: "c1" }] }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

        render(<LoginPage />);
        const user = userEvent.setup();

        await user.type(screen.getByLabelText(/e-mail/i), "user@example.com");
        await user.type(screen.getByLabelText(/senha/i), "123456");
        await user.click(screen.getByRole("button", { name: /entrar/i }));

        await waitFor(() => {
            expect(mockRouter.replace).toHaveBeenCalledWith("/pedidos");
            expect(mockRouter.refresh).toHaveBeenCalled();
        });

        expect(authMock.signInWithPassword).toHaveBeenCalledWith({
            email: "user@example.com",
            password: "123456",
        });
    });

    it("shows error toast for invalid email on login", async () => {
        render(<LoginPage />);
        const user = userEvent.setup();

        await user.type(screen.getByLabelText(/e-mail/i), "invalid-email");
        await user.type(screen.getByLabelText(/senha/i), "123456");
        await user.click(screen.getByRole("button", { name: /entrar/i }));

        expect(await screen.findByText("Informe um e-mail válido.")).toBeInTheDocument();
        expect(authMock.signInWithPassword).not.toHaveBeenCalled();
    });

    it("shows confirmation toast when signup requires email verification", async () => {
        params = new URLSearchParams("mode=signup");
        authMock.signUp.mockResolvedValue({ data: { session: null }, error: null });
        render(<LoginPage />);
        const user = userEvent.setup();

        await user.click(screen.getByRole("button", { name: /criar conta/i }));
        await user.type(screen.getByLabelText(/e-mail/i), "new@example.com");
        await user.type(screen.getByLabelText(/senha/i), "123456");
        await user.click(screen.getByRole("button", { name: /criar conta/i }));

        expect(
            await screen.findByText("Conta criada! Confirme seu e-mail para entrar.")
        ).toBeInTheDocument();
        expect(authMock.signUp).toHaveBeenCalled();
    });

    it("generates reset password link with origin and notifies the user", async () => {
        process.env.NEXT_PUBLIC_SITE_URL = "https://example.com";
        authMock.resetPasswordForEmail.mockResolvedValue({ error: null });
        render(<LoginPage />);
        const user = userEvent.setup();

        await user.type(screen.getByLabelText(/e-mail/i), "user@example.com");
        await user.click(screen.getByRole("button", { name: /esqueci minha senha/i }));

        await waitFor(() => {
            expect(authMock.resetPasswordForEmail).toHaveBeenCalledWith("user@example.com", {
                redirectTo: `${window.location.origin}/auth/reset`,
            });
        });

        expect(await screen.findByText("Te enviei um e-mail para redefinir a senha.")).toBeInTheDocument();
    });
});
