import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import { vi } from "vitest";

vi.mock("next/link", () => ({
    __esModule: true,
    default: ({ href, children }: { href: string; children: React.ReactNode }) => (
        <a href={href}>{children}</a>
    ),
}));

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});
