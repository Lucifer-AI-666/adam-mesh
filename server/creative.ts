import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID, randomInt } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";

type Kind = "video" | "music";
type JobState = "queued" | "completed" | "failed";
type Asset = { filename: string; subfolder: string; type: "output"; mime: string };
type Job = {
  id: string;
  ownerId: number;
  promptId: string;
  kind: Kind;
  created: number;
  state: JobState;
  assets: Asset[];
};

const jobs = new Map<string, Job>();
const HOUR = 60 * 60 * 1000;
const MAX_DOWNLOAD_BYTES = 16 * 1024 * 1024;
const workflowNames: Record<Kind, string> = {
  video: "video-api.json",
  music: "music-api.json",
};

/**
 * Intentionally loopback only. Do not expose ComfyUI on a public interface.
 * A device on a different machine requires a separately authorized bridge.
 */
function comfyBase(): string | null {
  const raw = process.env.ADAM_COMFYUI_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      return null;
    }
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function workflowPath(kind: Kind): string | null {
  const directory = process.env.ADAM_CREATIVE_WORKFLOW_DIR;
  if (!directory) return null;
  return resolve(directory, workflowNames[kind]);
}

async function workflowFor(kind: Kind): Promise<unknown | null> {
  const path = workflowPath(kind);
  if (!path) return null;
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    // Accept the exported ComfyUI API graph, not a full UI workflow.
    if (!Object.values(parsed).some(v => !!v && typeof v === "object" && "class_type" in v)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Substitute explicit, typed placeholders in a trusted workflow template. */
export function renderWorkflow(template: unknown, prompt: string, seconds: number, seed: number): unknown {
  const replacements: Record<string, string | number> = {
    "{{PROMPT}}": prompt,
    "{{SECONDS}}": seconds,
    "{{FRAMES}}": seconds * 12,
    "{{SEED}}": seed,
  };
  const transform = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(transform);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, transform(v)]));
    }
    if (typeof value !== "string") return value;
    if (value in replacements) return replacements[value];
    // Safe interpolation for text-only inputs. No eval or expression parsing.
    return value.replace(/\{\{PROMPT\}\}/g, prompt);
  };
  return transform(template);
}

function mediaType(filename: string, kind: Kind): string | null {
  const ext = filename.split(".").at(-1)?.toLowerCase();
  const audio: Record<string, string> = {
    mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", ogg: "audio/ogg", m4a: "audio/mp4",
  };
  const video: Record<string, string> = {
    mp4: "video/mp4", webm: "video/webm", gif: "image/gif",
  };
  return (kind === "video" ? video : audio)[ext || ""] || null;
}

/** ComfyUI exposes generated files under outputs[*].{videos,audio,gifs,images}. */
export function extractAssets(history: unknown, kind: Kind): Asset[] {
  if (!history || typeof history !== "object") return [];
  const outputs = (history as { outputs?: Record<string, Record<string, unknown>> }).outputs;
  if (!outputs || typeof outputs !== "object") return [];
  const results: Asset[] = [];
  for (const node of Object.values(outputs)) {
    if (!node || typeof node !== "object") continue;
    for (const key of ["videos", "audio", "gifs", "images"]) {
      const files = node[key];
      if (!Array.isArray(files)) continue;
      for (const file of files) {
        if (!file || typeof file !== "object") continue;
        const { filename, subfolder, type } = file as Record<string, unknown>;
        if (typeof filename !== "string" || !/^[\w .()-]{1,180}$/.test(filename) ||
            filename === "." || filename === "..") continue;
        const folder = typeof subfolder === "string" ? subfolder : "";
        if (folder && !/^[a-zA-Z0-9 _()-]{1,180}$/.test(folder)) continue;
        if (type !== "output") continue;
        const mime = mediaType(filename, kind);
        if (mime) results.push({ filename, subfolder: folder, type: "output", mime });
      }
    }
  }
  return results.slice(0, 12);
}

function userJob(id: string, ownerId: number): Job {
  const job = jobs.get(id);
  if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Generazione non trovata o scaduta" });
  if (job.ownerId !== ownerId) throw new TRPCError({ code: "FORBIDDEN" });
  return job;
}

async function comfyFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = comfyBase();
  if (!base) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Motore locale non configurato" });
  try {
    const response = await fetch(new URL(path, base), {
      ...init,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      throw new TRPCError({ code: "BAD_GATEWAY", message: "Il motore creativo ha restituito un errore (" + response.status + ")" });
    }
    return response;
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Motore creativo locale non raggiungibile" });
  }
}

function pruneJobs() {
  const now = Date.now();
  for (const [id, job] of Array.from(jobs.entries())) {
    if (now - job.created > 2 * HOUR) jobs.delete(id);
  }
}

export const creativeRouter = router({
  capabilities: protectedProcedure.query(async () => ({
    engineConfigured: !!comfyBase(),
    videoConfigured: !!(await workflowFor("video")),
    musicConfigured: !!(await workflowFor("music")),
    note: "Motore ComfyUI locale: modelli e workflow da installare sul server, nessuna API a pagamento abilitata.",
  })),

  generate: protectedProcedure
    .input(z.object({
      kind: z.enum(["video", "music"]),
      prompt: z.string().trim().min(8).max(1200),
      seconds: z.number().int().min(4).max(30),
    }))
    .mutation(async ({ ctx, input }) => {
      pruneJobs();
      const ownerId = ctx.user.id;
      const recent = Array.from(jobs.values()).filter(j => j.ownerId === ownerId && Date.now() - j.created < HOUR);
      if (recent.length >= 6) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Limite di 6 generazioni all'ora raggiunto" });
      }
      if (recent.some(j => j.state === "queued")) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Una generazione è già in corso" });
      }
      if (Array.from(jobs.values()).filter(j => j.state === "queued").length >= 2) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Motore occupato, riprova più tardi" });
      }
      const workflow = await workflowFor(input.kind);
      if (!workflow || !comfyBase()) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Installa ComfyUI e il workflow API per questo tipo di media" });
      }

      const id = randomUUID();
      const job: Job = {
        id, ownerId, promptId: "", kind: input.kind,
        created: Date.now(), state: "queued", assets: [],
      };
      jobs.set(id, job); // Reserve the slot before awaiting the remote engine.
      try {
        const graph = renderWorkflow(workflow, input.prompt, input.seconds, randomInt(1, 2147483647));
        const response = await comfyFetch("/prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: graph, client_id: id }),
        });
        const json: unknown = await response.json();
        const promptId = (json as { prompt_id?: unknown }).prompt_id;
        if (typeof promptId !== "string" || !/^[\w-]{8,128}$/.test(promptId)) {
          throw new TRPCError({ code: "BAD_GATEWAY", message: "ComfyUI non ha restituito un prompt_id valido" });
        }
        job.promptId = promptId;
        return { id };
      } catch (error) {
        jobs.delete(id);
        throw error;
      }
    }),

  status: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      pruneJobs();
      const job = userJob(input.id, ctx.user.id);
      if (job.state !== "queued") return { state: job.state, assets: job.assets.map((a, index) => ({ index, mime: a.mime, filename: a.filename })) };
      const response = await comfyFetch("/history/" + encodeURIComponent(job.promptId));
      const data = await response.json() as Record<string, {
        outputs?: Record<string, Record<string, unknown>>;
        status?: { status_str?: string; completed?: boolean };
      }>;
      const entry = data[job.promptId];
      if (entry) {
        const assets = extractAssets(entry, job.kind);
        if (entry.status?.status_str === "error") job.state = "failed";
        else if (assets.length) {
          job.assets = assets;
          job.state = "completed";
        } else if (entry.status?.completed) job.state = "failed";
      }
      return { state: job.state, assets: job.assets.map((a, index) => ({ index, mime: a.mime, filename: a.filename })) };
    }),

  download: protectedProcedure
    .input(z.object({ id: z.string().uuid(), index: z.number().int().min(0).max(11) }))
    .mutation(async ({ ctx, input }) => {
      pruneJobs();
      const job = userJob(input.id, ctx.user.id);
      if (job.state !== "completed") throw new TRPCError({ code: "PRECONDITION_FAILED" });
      const file = job.assets[input.index];
      if (!file) throw new TRPCError({ code: "NOT_FOUND" });
      const query = new URLSearchParams({
        filename: file.filename, subfolder: file.subfolder, type: "output",
      });
      const response = await comfyFetch("/view?" + query.toString());
      const expected = Number(response.headers.get("content-length") || 0);
      if (expected > MAX_DOWNLOAD_BYTES) {
        await response.body?.cancel();
        throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "File maggiore di 16 MB: usa l'interfaccia locale ComfyUI per salvarlo" });
      }
      const reader = response.body?.getReader();
      if (!reader) throw new TRPCError({ code: "BAD_GATEWAY", message: "Risposta media senza contenuto" });
      const chunks: Buffer[] = [];
      let total = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_DOWNLOAD_BYTES) {
          await reader.cancel();
          throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "File maggiore di 16 MB" });
        }
        chunks.push(Buffer.from(value));
      }
      return {
        filename: file.filename,
        mime: file.mime,
        base64: Buffer.concat(chunks, total).toString("base64"),
      };
    }),
});
