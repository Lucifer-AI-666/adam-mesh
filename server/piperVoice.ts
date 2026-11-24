import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const python = path.join(root, ".venv-piper", "bin", "python");
const script = path.join(root, "server", "piper_worker.py");
const model = path.join(root, "voices", "it_IT-paola-medium.onnx");

type Pending = {
  resolve: (value: { pcm: Buffer; rate: number } | null) => void;
};

let child: ChildProcessWithoutNullStreams | null = null;
let ready: Promise<void> | null = null;
let queue: Promise<void> = Promise.resolve();
const waiters: Pending[] = [];

export function piperAvailable(): boolean {
  return existsSync(python) && existsSync(script) && existsSync(model);
}

function dropWorker() {
  const current = child;
  child = null;
  ready = null;
  if (current && current.exitCode === null) current.kill("SIGTERM");
  while (waiters.length) waiters.shift()?.resolve(null);
}

function ensureWorker(): Promise<void> {
  if (!piperAvailable()) return Promise.reject(new Error("piper assente"));
  if (child && child.exitCode === null && ready) return ready;

  const proc = spawn(python, [script, model], { stdio: ["pipe", "pipe", "pipe"] });
  child = proc;
  const lines = createInterface({ input: proc.stdout });
  lines.on("line", (line) => {
    const waiter = waiters.shift();
    if (!waiter) return;
    try {
      const payload = JSON.parse(line) as { ok?: boolean; rate?: number; pcm?: string };
      if (!payload.ok || !payload.pcm || !payload.rate) {
        waiter.resolve(null);
        return;
      }
      waiter.resolve({ pcm: Buffer.from(payload.pcm, "hex"), rate: payload.rate });
    } catch {
      waiter.resolve(null);
    }
  });

  ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("piper lento ad avviarsi")), 20000);
    const onErr = (chunk: Buffer) => {
      if (!chunk.toString().includes("ready")) return;
      clearTimeout(timer);
      resolve();
    };
    proc.stderr.on("data", onErr);
    proc.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    proc.on("exit", () => {
      clearTimeout(timer);
      if (child === proc) dropWorker();
    });
  });
  return ready;
}

function pcm16To24k(pcm: Buffer, sampleRate: number): Buffer {
  const even = pcm.subarray(0, pcm.length - (pcm.length % 2));
  if (sampleRate === 24000) return even;
  const samples = Math.floor(even.length / 2);
  const outLen = Math.max(1, Math.round(samples * 24000 / sampleRate));
  const out = Buffer.alloc(outLen * 2);
  for (let i = 0; i < outLen; i++) {
    const srcPos = (i * sampleRate) / 24000;
    const left = Math.min(samples - 1, Math.floor(srcPos));
    const right = Math.min(samples - 1, left + 1);
    const frac = srcPos - Math.floor(srcPos);
    const a = even.readInt16LE(left * 2);
    const b = even.readInt16LE(right * 2);
    const value = a * (1 - frac) + b * frac;
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value))), i * 2);
  }
  return out;
}

/** PCM 16 bit mono 24000 Hz, voce Paola. Il modello resta in memoria. */
export async function speakPiperPcm(text: string): Promise<Buffer | null> {
  const spoken = await speakPiper(text);
  if (!spoken || spoken.pcm.length < 2) return null;
  return pcm16To24k(spoken.pcm, spoken.rate);
}

/** PCM 16 bit mono della voce Paola. Il modello resta in memoria. */
function speakPiper(text: string): Promise<{ pcm: Buffer; rate: number } | null> {
  const run = queue.then(async () => {
    await ensureWorker();
    if (!child) return null;
    return await new Promise<{ pcm: Buffer; rate: number } | null>((resolve) => {
      const timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        resolve(null);
      }, 8000);
      const waiter: Pending = {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
      };
      waiters.push(waiter);
      child?.stdin.write(JSON.stringify({ text }) + "\n");
    });
  }).catch((error) => {
    console.warn("[Voce] Piper non disponibile:", error);
    dropWorker();
    return null;
  });
  queue = run.then(() => undefined, () => undefined);
  return run;
}
