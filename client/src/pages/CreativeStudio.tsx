import Navbar from "@/components/Navbar";
import { trpc } from "@/lib/trpc";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Film, Music2, Play, Download, Loader2, ShieldCheck, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

type Kind = "video" | "music";
type Preview = { url: string; mime: string; filename: string };

const examples: Record<Kind, string> = {
  video: "Una città futuristica di notte, pioggia sulle strade, luci al neon, ripresa cinematografica lenta.",
  music: "Dark Amazigh trap, riff ipnotico di ribab e lotar, 808 profondo, percussioni secche, atmosfera notturna.",
};

function bytesFromBase64(base64: string): Uint8Array<ArrayBuffer> {
  const raw = atob(base64);
  const result = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) result[i] = raw.charCodeAt(i);
  return result;
}

export default function CreativeStudio() {
  const [kind, setKind] = useState<Kind>("video");
  const [prompt, setPrompt] = useState(examples.video);
  const [seconds, setSeconds] = useState(8);
  const [jobId, setJobId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const { data: capabilities, isLoading: loadingCapabilities, error: capabilityError } =
    trpc.creative.capabilities.useQuery(undefined, { retry: false });
  const generate = trpc.creative.generate.useMutation({
    onSuccess: data => {
      setJobId(data.id);
      toast.success("Generazione inviata al motore locale");
    },
    onError: error => toast.error(error.message),
  });
  const { data: job, error: jobError } = trpc.creative.status.useQuery(
    { id: jobId || "00000000-0000-0000-0000-000000000000" },
    { enabled: !!jobId, refetchInterval: 2500, retry: false }
  );
  const download = trpc.creative.download.useMutation({
    onSuccess: data => {
      try {
        const blob = new Blob([bytesFromBase64(data.base64)], { type: data.mime });
        const url = URL.createObjectURL(blob);
        setPreview({ url, mime: data.mime, filename: data.filename });
        toast.success("File pronto: puoi riprodurlo o scaricarlo");
      } catch {
        toast.error("Impossibile aprire questo file nel browser");
      }
    },
    onError: error => toast.error(error.message),
  });

  useEffect(() => {
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  const configured = !!capabilities?.engineConfigured &&
    (kind === "video" ? !!capabilities.videoConfigured : !!capabilities.musicConfigured);
  const canGenerate = configured && prompt.trim().length >= 8 && !generate.isPending &&
    (job?.state !== "queued");
  const changeKind = (next: Kind) => {
    setKind(next);
    setPrompt(examples[next]);
    setSeconds(next === "video" ? 8 : 20);
    setJobId(null);
    setPreview(null);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="container max-w-5xl py-8 space-y-6">
        <header className="space-y-2">
          <p className="text-xs font-mono tracking-widest text-primary uppercase">ADAM / Creative Lab</p>
          <h1 className="text-3xl font-bold">Studio Creativo</h1>
          <p className="text-muted-foreground">
            Genera video e musica originali da una descrizione usando workflow ComfyUI.
            Nessuna generazione simulata e nessuna API a pagamento attivata automaticamente.
          </p>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Button
            size="lg"
            variant={kind === "video" ? "default" : "outline"}
            onClick={() => changeKind("video")}
            className="justify-start gap-3 h-14"
          >
            <Film className="h-5 w-5" /> Video AI
          </Button>
          <Button
            size="lg"
            variant={kind === "music" ? "default" : "outline"}
            onClick={() => changeKind("music")}
            className="justify-start gap-3 h-14"
          >
            <Music2 className="h-5 w-5" /> Musica AI
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-5">
          <Card>
            <CardHeader>
              <CardTitle>{kind === "video" ? "Crea un video" : "Componi musica"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="creative-prompt" className="text-sm font-medium">
                  Descrivi cosa vuoi creare
                </label>
                <Textarea
                  id="creative-prompt"
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  maxLength={1200}
                  rows={6}
                  placeholder="Atmosfera, stile, strumenti, movimento, soggetto..."
                  className="resize-y"
                />
                <p className="text-xs text-muted-foreground text-right">{prompt.length}/1200</p>
              </div>

              <div className="space-y-2">
                <label htmlFor="creative-duration" className="text-sm font-medium">Durata richiesta</label>
                <select
                  id="creative-duration"
                  value={seconds}
                  onChange={e => setSeconds(Number(e.target.value))}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {(kind === "video" ? [4, 6, 8] : [10, 20, 30]).map(n => (
                    <option key={n} value={n}>{n} secondi</option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Il workflow installato deve supportare la durata richiesta.
                </p>
              </div>

              <Button
                className="w-full gap-2"
                size="lg"
                disabled={!canGenerate}
                onClick={() => {
                  setJobId(null);
                  setPreview(null);
                  generate.mutate({ kind, prompt: prompt.trim(), seconds });
                }}
              >
                {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {generate.isPending ? "Invio..." : kind === "video" ? "Genera video" : "Genera musica"}
              </Button>
              {loadingCapabilities && <p className="text-sm text-muted-foreground">Verifica configurazione...</p>}
              {capabilityError && (
                <p className="text-sm text-destructive">Accedi al tuo account Adam per usare Studio Creativo.</p>
              )}
              {!loadingCapabilities && !capabilityError && !configured && (
                <div className="rounded-lg border border-amber-500/30 p-3 text-sm flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    Motore o workflow non configurato. Per attivarlo segui
                    <code className="mx-1">docs/creative-studio.md</code> nel repository Adam.
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Risultato</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="h-4 w-4" />
                Generazioni accessibili solo all'account che le avvia
              </div>
              {!jobId && (
                <p className="text-sm text-muted-foreground">
                  Il risultato comparirà qui dopo la generazione. Nessun file è stato creato finché non invii una richiesta.
                </p>
              )}
              {jobId && job?.state === "queued" && (
                <p className="flex items-center gap-2 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" /> Il motore sta elaborando...
                </p>
              )}
              {job?.state === "failed" && (
                <p className="text-destructive text-sm">Generazione fallita: controlla workflow e log locali di ComfyUI.</p>
              )}
              {jobError && <p className="text-destructive text-sm">{jobError.message}</p>}
              {job?.state === "completed" && (
                <div className="space-y-3">
                  <p className="text-sm">Generazione completata. {job.assets.length} file disponibili.</p>
                  {job.assets.map(asset => (
                    <Button
                      key={asset.index}
                      size="sm"
                      variant="outline"
                      className="w-full justify-start"
                      disabled={download.isPending}
                      onClick={() => download.mutate({ id: jobId!, index: asset.index })}
                    >
                      {download.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                      Apri {asset.filename}
                    </Button>
                  ))}
                </div>
              )}
              {preview && (
                <div className="space-y-3">
                  {preview.mime.startsWith("video/") ? (
                    <video src={preview.url} controls playsInline className="w-full rounded-lg" />
                  ) : preview.mime.startsWith("audio/") ? (
                    <audio src={preview.url} controls className="w-full" />
                  ) : (
                    <img src={preview.url} alt="Risultato generato" className="w-full rounded-lg" />
                  )}
                  <a
                    href={preview.url}
                    download={preview.filename}
                    className="inline-flex items-center gap-2 text-primary underline underline-offset-4 text-sm"
                  >
                    <Download className="h-4 w-4" /> Scarica {preview.filename}
                  </a>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Anteprima limitata a 16 MB per file. I file più grandi si recuperano dalla macchina che esegue ComfyUI.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
