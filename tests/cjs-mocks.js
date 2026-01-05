const Module = require("module");
const React = require("react");

require.extensions[".css"] = (module) => {
    module.exports = new Proxy({}, { get: (_target, prop) => String(prop) });
};

const mockSupabase = {
    createClient() {
        return {
            auth: {
                signInWithPassword: async () => ({}),
                signUp: async () => ({ data: { session: null } }),
                resetPasswordForEmail: async () => ({}),
            },
        };
    },
};

const mockNavigation = {
    useRouter: () => ({ replace: () => {}, refresh: () => {} }),
    useSearchParams: () => ({ get: () => null }),
};

const mockLink = React.forwardRef(function Link(props, ref) {
    return React.createElement("a", { ...props, ref }, props.children);
});

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === "@/lib/supabase/client") {
        return mockSupabase;
    }

    if (request === "next/navigation") {
        return mockNavigation;
    }

    if (request === "next/link") {
        return { __esModule: true, default: mockLink };
    }

    if (request.includes(".module.css")) {
        const stylesProxy = new Proxy({}, { get: (_target, prop) => String(prop) });
        return { __esModule: true, default: stylesProxy };
    }

    return originalLoad(request, parent, isMain);
};
