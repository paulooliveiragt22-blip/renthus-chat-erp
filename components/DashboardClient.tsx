"use client";
import React, { useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import ProdifySidebar from "@/components/ProdifySidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const COLORS = ["#6F4ACF", "#0DAA00", "#FF6600"];

type Order = {
  id: string;
  created_at: string;
  customers?: { name?: string } | null;
  total_amount?: number;
  status?: string;
};

type OrderStats = {
  stats?: { totalRevenue?: number };
  daily?: { date: string; revenue: number }[];
};

type StatusSummary = Record<string, { count?: number } | number> | null;

// Hooks de dados usando TanStack Query (somente leitura)
function useDashboardOrders() {
  return useQuery({
    queryKey: ["dashboard", "orders", { limit: 8 }],
    queryFn: async () => {
      const res = await fetch("/api/orders/list?limit=8", {
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      return Array.isArray(json.orders) ? (json.orders as Order[]) : [];
    },
  });
}

function useDashboardStats() {
  return useQuery({
    queryKey: ["dashboard", "stats"],
    queryFn: async () => {
      const res = await fetch("/api/orders/stats", {
        credentials: "include",
      });
      const json = (await res.json().catch(() => null)) as OrderStats | null;
      return json;
    },
  });
}

function useDashboardStatusSummary() {
  return useQuery({
    queryKey: ["dashboard", "statusSummary"],
    queryFn: async () => {
      const res = await fetch("/api/orders/status", {
        credentials: "include",
      });
      const json = await res.json().catch(() => null);
      return (json as StatusSummary) ?? null;
    },
  });
}

export default function DashboardClient() {
  // QueryClient local ao dashboard para não impactar o restante da app
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 1000 * 60, // 1 min
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <DashboardContent />
    </QueryClientProvider>
  );
}

const DashboardContent: React.FC = () => {
  const { data: orders = [], isLoading: loadingOrders } = useDashboardOrders();
  const { data: stats, isLoading: loadingStats } = useDashboardStats();
  const { data: statusSummary, isLoading: loadingStatus } =
    useDashboardStatusSummary();

  function fmtBRL(n?: number) {
    return (n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
  }

  const pieData = statusSummary
    ? Object.entries(statusSummary).map(([k, v]: any) => ({
        name: k,
        value: v.count ?? v,
      }))
    : [
        { name: "A", value: 58 },
        { name: "B", value: 20 },
        { name: "C", value: 22 },
      ];


  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-gray-50">
      <ProdifySidebar />

      <main className="flex-1 p-6 md:p-8">
        {/* Top bar */}
        <div className="flex items-center gap-4 mb-6">
          <h2 className="text-2xl font-semibold text-gray-900">Sales Admin</h2>
          <div className="flex-1" />
          <div className="w-full max-w-md">
            <Input placeholder="Prodify Finder" />
          </div>
          <Button className="ml-3" variant="default" size="md">
            Add new product
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <Card className="lg:col-span-2">
            <CardContent className="p-5">
              <div className="text-prodifyOrange font-bold">Update</div>
              <h3 className="mt-2 text-xl font-bold">
                This Week&apos;s Sales Revenue
                <br />
                <span className="text-prodifyGreen">Increased by 40%</span>
              </h3>
              <div className="mt-4 text-gray-500">Monitor Stats &gt;</div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <div className="font-semibold">Total Earnings</div>
              <div className="text-2xl font-bold mt-2">
                R$ {fmtBRL(stats?.stats?.totalRevenue)}
              </div>
              <div className="text-sm text-gray-500 mt-2">
                Up 35% Month-over-Month
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <div className="font-semibold">Net Return</div>
              <div className="text-2xl font-bold mt-2">
                R$ {fmtBRL((stats?.stats?.totalRevenue || 0) * 0.2)}
              </div>
              <div className="text-sm text-gray-500 mt-2">
                Down 15% Month-over-Month
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardContent className="p-5">
              <div className="font-bold text-lg mb-4">Transaction</div>
              <div className="divide-y">
                {loadingOrders && (
                  <div className="py-4 text-sm text-gray-500">
                    Carregando transações...
                  </div>
                )}
                {!loadingOrders &&
                  orders.map((o) => (
                  <div key={o.id} className="py-3 flex justify-between items-center">
                    <div>
                      <div className="font-semibold">{o.customers?.name ?? "-"}</div>
                      <div className="text-xs text-gray-500">
                        {new Date(o.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold">R$ {fmtBRL(o.total_amount)}</div>
                      <div
                        className={`text-xs mt-1 ${
                          o.status === "new" ? "text-prodifyGreen" : "text-prodifyOrange"
                        }`}
                      >
                        {o.status}
                      </div>
                    </div>
                  ))}
                {!loadingOrders && orders.length === 0 && (
                  <div className="py-4 text-sm text-gray-500">
                    Nenhuma transação encontrada.
                  </div>
                )}
              </div>
            </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white p-4 rounded-lg shadow-sm">
                <div className="font-semibold">Revenue</div>
                <div className="text-2xl font-bold mt-2">R$ {fmtBRL(stats?.stats?.totalRevenue)}</div>
                <div className="h-36 mt-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={(stats?.daily ?? []).map((d: any) => ({ date: d.date, revenue: d.revenue }))}>
                      <XAxis dataKey="date" hide />
                      <YAxis hide />
                      <Tooltip formatter={(value: any) => [`R$ ${fmtBRL(value as number)}`, "Receita"]} />
                      <Line type="monotone" dataKey="revenue" stroke="#3B246B" strokeWidth={3} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-white p-4 rounded-lg shadow-sm">
                <div className="font-semibold">Sales Report</div>
                <div className="mt-4 space-y-4">
                  <div>
                    <div className="flex justify-between text-sm">
                      <span>Product Launched</span>
                      <span className="font-bold">233</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded mt-2">
                      <div className="h-2 bg-prodifyPurple rounded" style={{ width: "70%" }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm">
                      <span>Ongoing product</span>
                      <span className="font-bold">180</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded mt-2">
                      <div className="h-2 bg-prodifyOrange rounded" style={{ width: "50%" }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* right column */}
          <aside className="space-y-4">
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <div className="flex justify-between items-center">
                <div className="font-semibold">Total view performance</div>
              </div>
              <div className="h-48 mt-3">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      innerRadius={40}
                      outerRadius={70}
                      paddingAngle={4}
                    >
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="text-center font-bold mt-2">
                Total count
                <br />
                496K
              </div>
            </div>

            <div className="bg-prodifyPurple text-white p-4 rounded-lg shadow-sm">
              <div className="font-bold text-lg">Level up your sales</div>
              <div className="text-sm text-white/80 mt-2">
                An any way to manage sales with care and precision.
              </div>
              <div className="mt-4">
                <button className="bg-prodifyOrange text-white px-4 py-2 rounded-md font-bold">
                  Upgrade to Premium
                </button>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
};
