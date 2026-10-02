import Navbar from "@/components/Navbar";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, BookOpen, CheckCircle, ExternalLink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { getLoginUrl } from "@/const";
import { useNotifications } from "@/contexts/NotificationContext";

export default function AdminKnowledge() {
  const { user, isAuthenticated, loading } = useAuth();
  const { addNotification } = useNotifications();
  const { data: entries, refetch } = trpc.knowledge.list.useQuery(undefined, { enabled: user?.role === "admin" });
  const createMutation = trpc.knowledge.create.useMutation({
    onSuccess: (_data, variables) => {
      toast.success("Voce aggiunta");
      addNotification("knowledge_update", "Knowledge base aggiornata", `Nuova voce aggiunta: "${variables.title}"`);
      refetch();
      setDialogOpen(false);
    },
  });
  const deleteMutation = trpc.knowledge.delete.useMutation({ onSuccess: () => { toast.success("Voce eliminata"); refetch(); } });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ title: "", content: "", category: "", sourceUrl: "", verified: true });

  if (loading) return <div className="min-h-screen bg-background"><Navbar /></div>;

  if (!isAuthenticated || user?.role !== "admin") {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="container py-12 text-center">
          <BookOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h1 className="text-xl font-bold mb-2">Accesso riservato</h1>
          <p className="text-muted-foreground">Solo gli admin possono gestire la knowledge base.</p>
          {!isAuthenticated && <a href={getLoginUrl()}><Button className="mt-4">Accedi</Button></a>}
        </main>
      </div>
    );
  }

  const handleCreate = () => {
    if (!form.title || !form.content) { toast.error("Titolo e contenuto sono obbligatori"); return; }
    createMutation.mutate(form);
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">
            <span className="text-primary">Knowledge</span> Base
          </h1>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1">
                <Plus className="h-4 w-4" /> Nuova Voce
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Aggiungi alla Knowledge Base</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Titolo *</Label>
                  <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Titolo della voce" />
                </div>
                <div>
                  <Label>Contenuto *</Label>
                  <Textarea value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} rows={5} placeholder="Informazione dettagliata..." />
                </div>
                <div>
                  <Label>Categoria</Label>
                  <Input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="es. Anagrafe, Turismo..." />
                </div>
                <div>
                  <Label>URL Fonte</Label>
                  <Input value={form.sourceUrl} onChange={e => setForm({ ...form, sourceUrl: e.target.value })} placeholder="https://..." />
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={form.verified} onCheckedChange={v => setForm({ ...form, verified: v })} />
                  <Label>Verificata</Label>
                </div>
                <Button onClick={handleCreate} disabled={createMutation.isPending} className="w-full">
                  {createMutation.isPending ? "Salvataggio..." : "Aggiungi"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="space-y-3">
          {entries?.map(entry => (
            <Card key={entry.id}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium text-sm">{entry.title}</p>
                      {entry.verified && <CheckCircle className="h-3.5 w-3.5 text-[oklch(0.72_0.18_150)]" />}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{entry.content}</p>
                    <div className="flex items-center gap-2">
                      {entry.category && <Badge variant="outline" className="text-xs">{entry.category}</Badge>}
                      {entry.sourceUrl && (
                        <a href={entry.sourceUrl} target="_blank" className="text-xs text-primary hover:underline flex items-center gap-1">
                          <ExternalLink className="h-3 w-3" /> Fonte
                        </a>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { if (confirm("Eliminare questa voce?")) deleteMutation.mutate({ id: entry.id }); }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {entries?.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              Knowledge base vuota. Aggiungi informazioni verificate su Acqui Terme!
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
