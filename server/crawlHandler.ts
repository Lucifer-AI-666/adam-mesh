import type { Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { ENV } from "./_core/env";
import { invokeLLM } from "./_core/llm";
import { addKnowledgeEntry, addCrawlLog } from "./db";
import { notifyOwner } from "./_core/notification";

const CRON_TASK_ID = "external-cron";

// Scheduled crawls authenticate with `Authorization: Bearer <CRON_SECRET>`; disabled when unset.
function isAuthorizedCron(req: Request): boolean {
  if (!ENV.cronSecret) return false;
  const header = req.headers.authorization ?? "";
  const provided = Buffer.from(header.startsWith("Bearer ") ? header.slice(7).trim() : "");
  const expected = Buffer.from(ENV.cronSecret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

// URLs to crawl from the Comune di Acqui Terme official site
const CRAWL_URLS = [
  "https://www.comune.acquiterme.al.it",
  "https://www.comune.acquiterme.al.it/servizi",
  "https://www.comune.acquiterme.al.it/amministrazione",
  "https://www.comune.acquiterme.al.it/novita",
  "https://www.comune.acquiterme.al.it/vivere-il-comune",
];

async function fetchPageContent(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "ADAM-CivicBot/1.0 (Acqui Terme Civic Assistant)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return null;
    const html = await response.text();
    // Strip HTML tags for text content
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, 10000); // Limit content size
  } catch {
    return null;
  }
}

async function extractKnowledgeFromContent(content: string, url: string) {
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `Sei un estrattore di informazioni per la knowledge base di ADAM, l'assistente civico di Acqui Terme.
Analizza il contenuto della pagina web e estrai le informazioni utili per i cittadini.
Restituisci un JSON array con le voci estratte. Ogni voce deve avere: title, content, category.
Le categorie possibili sono: Anagrafe, Tributi, Urbanistica, Servizi Sociali, Cultura, Turismo, Sport, Trasporti, Ambiente, Scuola, Salute, Commercio, Altro.
Estrai SOLO informazioni concrete e utili (orari, contatti, procedure, servizi). Ignora testo generico o di navigazione.
Se non ci sono informazioni utili, restituisci un array vuoto [].`
        },
        { role: "user", content: `URL: ${url}\n\nContenuto:\n${content.slice(0, 5000)}` }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "knowledge_extraction",
          strict: true,
          schema: {
            type: "object",
            properties: {
              entries: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    content: { type: "string" },
                    category: { type: "string" },
                  },
                  required: ["title", "content", "category"],
                  additionalProperties: false,
                },
              },
            },
            required: ["entries"],
            additionalProperties: false,
          },
        },
      },
    });

    const parsed = JSON.parse(response.choices[0].message.content as string);
    return parsed.entries || [];
  } catch {
    return [];
  }
}

export async function crawlHandler(req: Request, res: Response) {
  try {
    // Authenticate the cron request
    if (!isAuthorizedCron(req)) {
      return res.status(403).json({ error: "cron-only" });
    }

    let totalAdded = 0;
    let totalErrors = 0;

    for (const url of CRAWL_URLS) {
      try {
        const content = await fetchPageContent(url);
        if (!content) {
          await addCrawlLog({ url, status: "error", errorMessage: "Failed to fetch" });
          totalErrors++;
          continue;
        }

        const entries = await extractKnowledgeFromContent(content, url);
        let added = 0;

        for (const entry of entries) {
          try {
            await addKnowledgeEntry({
              title: entry.title,
              content: entry.content,
              category: entry.category,
              sourceUrl: url,
              verified: true,
            });
            added++;
          } catch {
            // Skip duplicates or errors
          }
        }

        await addCrawlLog({
          url,
          status: "success",
          entriesAdded: added,
          scheduleCronTaskUid: CRON_TASK_ID,
        });
        totalAdded += added;
      } catch (err: any) {
        await addCrawlLog({
          url,
          status: "error",
          errorMessage: err?.message || "Unknown error",
          scheduleCronTaskUid: CRON_TASK_ID,
        });
        totalErrors++;
      }
    }

    // Notify owner of crawl results
    if (totalAdded > 0 || totalErrors > 0) {
      await notifyOwner({
        title: "🔄 ADAM Crawl Completato",
        content: `Crawling completato: ${totalAdded} voci aggiunte, ${totalErrors} errori su ${CRAWL_URLS.length} URL.`,
      });
    }

    res.json({
      ok: true,
      urlsCrawled: CRAWL_URLS.length,
      entriesAdded: totalAdded,
      errors: totalErrors,
    });
  } catch (err: any) {
    res.status(500).json({
      error: err?.message || "Crawl failed",
      stack: err?.stack,
      context: { url: req.url },
      timestamp: new Date().toISOString(),
    });
  }
}
