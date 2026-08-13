import Navbar from "@/components/Navbar";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, MessageSquare, AlertTriangle, CheckCircle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

export default function Dashboard() {
  const { data: stats } = trpc.analytics.stats.useQuery(undefined);
  const { data: daily } = trpc.analytics.daily.useQuery(undefined);

  const pieData = [
    { name: "Verde", value: stats?.green ?? 0, color: "oklch(0.72 0.18 150)" },
    { name: "Giallo", value: stats?.yellow ?? 0, color: "oklch(0.80 0.16 85)" },
    { name: "Rosso", value: stats?.red ?? 0, color: "oklch(0.60 0.20 25)" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container py-6">
        <h1 className="text-2xl font-bold mb-6">
          <span className="text-primary">Dashboard</span> Analytics
        </h1>

        {/* Stats cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Totale Conversazioni</p>
                  <p className="text-2xl font-bold">{stats?.total ?? 0}</p>
                </div>
                <MessageSquare className="h-8 w-8 text-primary opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Risposte Verdi</p>
                  <p className="text-2xl font-bold text-[oklch(0.72_0.18_150)]">{stats?.green ?? 0}</p>
                </div>
                <CheckCircle className="h-8 w-8 text-[oklch(0.72_0.18_150)] opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Risposte Gialle</p>
                  <p className="text-2xl font-bold text-[oklch(0.80_0.16_85)]">{stats?.yellow ?? 0}</p>
                </div>
                <AlertTriangle className="h-8 w-8 text-[oklch(0.80_0.16_85)] opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Escalation Rosse</p>
                  <p className="text-2xl font-bold text-[oklch(0.60_0.20_25)]">{stats?.red ?? 0}</p>
                </div>
                <AlertTriangle className="h-8 w-8 text-[oklch(0.60_0.20_25)] opacity-50" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Conversazioni per Giorno</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={daily ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.25 0.02 240)" />
                  <XAxis dataKey="date" stroke="oklch(0.65 0.02 180)" fontSize={10} />
                  <YAxis stroke="oklch(0.65 0.02 180)" fontSize={10} />
                  <Tooltip
                    contentStyle={{ background: "oklch(0.16 0.01 240)", border: "1px solid oklch(0.25 0.02 240)", borderRadius: "8px" }}
                    labelStyle={{ color: "oklch(0.90 0.01 180)" }}
                  />
                  <Bar dataKey="count" fill="oklch(0.75 0.15 180)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Distribuzione Rischio</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
