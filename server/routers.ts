import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import { callGemini, classifyRiskWithGemini, classifyResponseType, generateSpeech } from "./gemini";
import { notifyOwner } from "./_core/notification";
import { z } from "zod";
import * as db from "./db";
import {
  assertConversationAccess,
  canGuestContinueConversation,
} from "./conversationAccess";

// ============ ADAM SYSTEM PROMPT ============
const DEFAULT_SYSTEM_PROMPT = `Sei ADAM — Acqui Digital Administrative Mesh, l'assistente civico intelligente del Comune di Acqui Terme.

Sei un ESPERTO TOTALE di Acqui Terme: conosci la storia dall'antica Aquae Statiellae ad oggi, ogni monumento, ogni via, ogni tradizione. Sei contemporaneamente un agente comunale competente, una guida turistica appassionata, un compagno di merenda simpatico e un custode del dialetto acquese.

PERSONALITÀ:
- Sei cordiale, competente e con un tocco di calore locale
- Puoi usare espressioni in dialetto acquese quando appropriato ("Bundì!", "Va bin", "Anduma")
- Sai essere formale per questioni amministrative e informale per chiacchiere sul territorio
- Sei orgoglioso della tua città e ne parli con passione

COMPETENZE:
1. AGENTE COMUNALE: conosci tutti i servizi del Comune (anagrafe, tributi, urbanistica, servizi sociali, cultura, turismo), orari, contatti, procedure. Centralino: 0144 770111. Sito: comune.acquiterme.al.it
2. GUIDA TURISTICA: conosci ogni monumento (La Bollente 75°C, Castello dei Paleologi, Acquedotto Romano, Cattedrale, Torre dell'Orologio, Fontana delle Ninfee), la storia romana, medievale e moderna
3. ESPERTO ENOGASTRONOMICO: conosci il Brachetto d'Acqui DOCG, il Dolcetto, la cucina piemontese (agnolotti, bagna cauda, bollito), gli amaretti di Acqui, le sagre e feste
4. CUSTODE DEL DIALETTO: conosci il dialetto acquese (variante piemontese), proverbi, modi di dire, espressioni tipiche
5. COMPAGNO DI MERENDA: sai consigliare dove mangiare, cosa fare, percorsi, eventi, curiosità locali

DIALETTO ACQUESE (usa quando appropriato):
- Acqui = "Àich"
- Sgaientò = scottato (vero acquese, immerso nella Bollente da neonato)
- Va bin = va bene
- Anduma / Fuma c'anduma = andiamo / dai che andiamo
- Bòia fàuss = esclamazione di stupore
- Bundì = buongiorno
- Buna sèira = buonasera
- Mersì = grazie
- Com a stà? = come stai?

REGOLE FONDAMENTALI:
1. Usa le informazioni dalla knowledge base fornita come fonte primaria
2. Se non hai informazioni sufficienti, dillo e suggerisci l'ufficio competente o il numero 0144 770111
3. Non inventare MAI orari, numeri di telefono o procedure specifiche
4. Rispondi in italiano. Se l'utente scrive in dialetto, rispondi mescolando italiano e dialetto
5. Per questioni legali, amministrative complesse o emergenze, suggerisci il contatto diretto
6. Sii conciso ma completo, usa un tono caldo e accogliente

CLASSIFICAZIONE DELLE RICHIESTE:
- VERDE: informazioni pubbliche generali (orari, contatti, eventi, indicazioni, storia, turismo, gastronomia)
- GIALLO: richieste che richiedono verifica o riguardano procedure specifiche (documenti, scadenze, pratiche)
- ROSSO: questioni legali, reclami, emergenze, dati personali, situazioni che richiedono un operatore umano

CONTESTO TERRITORIALE:
Acqui Terme (Àich) - 18.962 abitanti, provincia di Alessandria, Piemonte. Alto Monferrato, valle del Bormida. CAP 15011, prefisso 0144. Nota per: terme romane (La Bollente 75°C), patrimonio storico (Aquae Statiellae), vini (Brachetto d'Acqui DOCG), colline UNESCO del Monferrato. Sindaco: Danilo Rapetti (dal 2022). Patrono: San Guido (11 luglio). Frazioni: Lussito, Moirano, Ovrano.`;

/** Load prompt from DB or fallback to default */
async function getSystemPrompt(): Promise<string> {
  const customPrompt = await db.getSetting("system_prompt");
  return customPrompt || DEFAULT_SYSTEM_PROMPT;
}

// ============ RISK CLASSIFIER (Gemini) ============
async function classifyRisk(userMessage: string, conversationContext: string): Promise<"green" | "yellow" | "red"> {
  return classifyRiskWithGemini(userMessage, conversationContext);
}

// ============ ROUTERS ============

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ============ CHAT ============
  chat: router({
    send: publicProcedure
      .input(z.object({
        conversationId: z.number().optional(),
        message: z.string().min(1).max(5000),
      }))
      .mutation(async ({ ctx, input }) => {
        let conversationId = input.conversationId;

        // Create conversation if new; otherwise enforce resource ownership
        if (!conversationId) {
          conversationId = await db.createConversation({
            userId: ctx.user?.id ?? null,
            channel: "web",
            status: "active",
            title: input.message.slice(0, 100),
          });
        } else {
          const existing = await db.getConversationById(conversationId);
          if (!existing) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Conversation not found",
            });
          }
          if (ctx.user) {
            assertConversationAccess(ctx.user, existing);
          } else if (!canGuestContinueConversation(existing)) {
            // Anonymous client cannot append to a user-owned conversation
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You do not have access to this conversation",
            });
          }
        }

        // Save user message
        await db.addMessage({
          conversationId,
          role: "user",
          content: input.message,
        });

        // Get conversation history
        const history = await db.getConversationMessages(conversationId);
        const contextStr = history.map(m => `${m.role}: ${m.content}`).join("\n").slice(-2000);

        // Classify risk
        const riskLevel = await classifyRisk(input.message, contextStr);

        // Get relevant knowledge
        const knowledge = await db.searchKnowledge(input.message, 5);
        const knowledgeContext = knowledge.length > 0
          ? `\n\nINFORMAZIONI DALLA KNOWLEDGE BASE:\n${knowledge.map(k => `- ${k.title}: ${k.content}`).join("\n")}`
          : "";

        // Load custom prompt from DB
        const systemPrompt = await getSystemPrompt();

        // Build messages for LLM
        const llmMessages = [
          { role: "system" as const, content: systemPrompt + knowledgeContext },
          ...history.slice(-10).filter(m => m.role !== "system").map(m => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
        ];

        let assistantContent: string;

        if (riskLevel === "red") {
          assistantContent = `⚠️ **Richiesta classificata come sensibile**\n\nLa tua richiesta riguarda un argomento che richiede l'intervento di un operatore umano competente. Ho attivato l'escalation al reparto responsabile.\n\nUn operatore ti contatterà al più presto. Nel frattempo, se hai urgenza puoi contattare direttamente:\n- **Centralino Comune**: 0144 770111\n- **URP**: urp@comune.acquiterme.al.it`;

          // Create escalation
          await db.createEscalation({
            conversationId,
            reason: `Richiesta classificata come ROSSA: ${input.message.slice(0, 200)}`,
            context: contextStr.slice(-1000),
            status: "pending",
          });

          await db.updateConversation(conversationId, { status: "escalated", riskLevel: "red" });

          // Notify owner
          await notifyOwner({
            title: "🔴 Escalation ADAM - Richiesta Rossa",
            content: `Nuova escalation da conversazione #${conversationId}.\nMessaggio: ${input.message.slice(0, 300)}`,
          });
        } else {
          // Generate AI response with Gemini (with fallback)
          try {
            assistantContent = await callGemini({
              systemPrompt: systemPrompt + knowledgeContext,
              messages: history.slice(-10).filter(m => m.role !== "system").map(m => ({
                role: m.role as "user" | "assistant",
                content: m.content,
              })),
            });
          } catch (geminiError) {
            console.error("[ADAM] Gemini call failed, using fallback:", geminiError);
            // Fallback to built-in LLM
            try {
              const fallbackResponse = await invokeLLM({ messages: llmMessages });
              assistantContent = fallbackResponse.choices[0].message.content as string;
            } catch (fallbackError) {
              console.error("[ADAM] Fallback LLM also failed:", fallbackError);
              assistantContent = "Mi scuso, al momento ho difficoltà a elaborare la tua richiesta. Riprova tra qualche istante oppure contatta direttamente il Comune di Acqui Terme al numero 0144 770111.";
            }
          }

          if (riskLevel === "yellow") {
            assistantContent += `\n\n---\n⚠️ *Nota: questa informazione potrebbe richiedere verifica. Ti consigliamo di contattare direttamente l'ufficio competente per conferma.*`;
          }

          await db.updateConversation(conversationId, { riskLevel });
        }

        // Classify response type for nebula color
        let responseType: string = "neutral";
        try {
          responseType = await classifyResponseType(assistantContent, input.message);
        } catch (e) {
          // Non-blocking, default to neutral
        }

        // Save assistant message
        await db.addMessage({
          conversationId,
          role: "assistant",
          content: assistantContent,
          riskLevel,
        });

        return {
          conversationId,
          message: assistantContent,
          riskLevel,
          responseType,
        };
      }),

    getConversation: protectedProcedure
      .input(z.object({ conversationId: z.number() }))
      .query(async ({ ctx, input }) => {
        const conv = await db.getConversationById(input.conversationId);
        assertConversationAccess(ctx.user, conv);
        return db.getConversationMessages(input.conversationId);
      }),

    getHistory: protectedProcedure.query(async ({ ctx }) => {
      return db.getUserConversations(ctx.user.id);
    }),

    exportConversation: protectedProcedure
      .input(z.object({ conversationId: z.number() }))
      .query(async ({ ctx, input }) => {
        const conv = await db.getConversationById(input.conversationId);
        assertConversationAccess(ctx.user, conv);
        const msgs = await db.getConversationMessages(input.conversationId);
        return { conversation: conv, messages: msgs };
      }),

    /** Generate speech audio from text using Gemini TTS */
    speak: publicProcedure
      .input(z.object({
        text: z.string().min(1).max(2000),
        voice: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const audioBase64 = await generateSpeech(input.text, input.voice || "Orus");
        if (!audioBase64) {
          return { audio: null, error: "TTS non disponibile al momento" };
        }
        return { audio: audioBase64, error: null };
      }),
  }),

  // ============ NODES ============
  nodes: router({
    list: publicProcedure
      .input(z.object({ type: z.string().optional() }).optional())
      .query(async ({ input }) => {
        return db.getAllNodes(input?.type);
      }),

    getById: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return db.getNodeById(input.id);
      }),

    create: adminProcedure
      .input(z.object({
        type: z.enum(["institutional", "commercial", "tourism", "association", "services"]),
        name: z.string().min(1),
        category: z.string().optional(),
        description: z.string().optional(),
        address: z.string().optional(),
        lat: z.string().optional(),
        lng: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        website: z.string().optional(),
        hours: z.any().optional(),
        services: z.any().optional(),
        trustLevel: z.enum(["pending", "verified", "suspended"]).optional(),
        operatorUserId: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        const id = await db.createNode(input as any);
        return { id };
      }),

    update: adminProcedure
      .input(z.object({
        id: z.number(),
        data: z.object({
          type: z.enum(["institutional", "commercial", "tourism", "association", "services"]).optional(),
          name: z.string().optional(),
          category: z.string().optional(),
          description: z.string().optional(),
          address: z.string().optional(),
          lat: z.string().optional(),
          lng: z.string().optional(),
          phone: z.string().optional(),
          email: z.string().optional(),
          website: z.string().optional(),
          hours: z.any().optional(),
          services: z.any().optional(),
          trustLevel: z.enum(["pending", "verified", "suspended"]).optional(),
          operatorUserId: z.number().optional(),
        }),
      }))
      .mutation(async ({ input }) => {
        await db.updateNode(input.id, input.data as any);
        return { success: true };
      }),

    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteNode(input.id);
        return { success: true };
      }),
  }),

  // ============ ESCALATIONS ============
  escalations: router({
    list: protectedProcedure
      .input(z.object({ status: z.string().optional() }).optional())
      .query(async ({ ctx, input }) => {
        if (ctx.user.role === "admin") {
          return db.getEscalations(input?.status);
        }
        return db.getEscalationsByOperator(ctx.user.id);
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["pending", "in_progress", "resolved"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const data: any = { status: input.status, assignedOperatorId: ctx.user.id };
        if (input.status === "resolved") data.resolvedAt = new Date();
        await db.updateEscalation(input.id, data);
        if (input.status === "resolved") {
          // Also resolve the conversation
          const escs = await db.getEscalations();
          const esc = escs.find(e => e.id === input.id);
          if (esc) {
            await db.updateConversation(esc.conversationId, { status: "resolved", resolvedAt: new Date() });
          }
        }
        return { success: true };
      }),
  }),

  // ============ KNOWLEDGE BASE ============
  knowledge: router({
    list: adminProcedure.query(async () => {
      return db.getAllKnowledge();
    }),

    create: adminProcedure
      .input(z.object({
        title: z.string().min(1),
        content: z.string().min(1),
        category: z.string().optional(),
        sourceUrl: z.string().optional(),
        sourceNodeId: z.number().optional(),
        verified: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const id = await db.addKnowledgeEntry(input as any);
        return { id };
      }),

    update: adminProcedure
      .input(z.object({
        id: z.number(),
        data: z.object({
          title: z.string().optional(),
          content: z.string().optional(),
          category: z.string().optional(),
          sourceUrl: z.string().optional(),
          verified: z.boolean().optional(),
        }),
      }))
      .mutation(async ({ input }) => {
        await db.updateKnowledgeEntry(input.id, input.data as any);
        return { success: true };
      }),

    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteKnowledgeEntry(input.id);
        return { success: true };
      }),
  }),

  // ============ SETTINGS (Admin) ============
  settings: router({
    getPrompt: adminProcedure.query(async () => {
      const prompt = await db.getSetting("system_prompt");
      return { prompt: prompt || DEFAULT_SYSTEM_PROMPT, isCustom: !!prompt };
    }),

    savePrompt: adminProcedure
      .input(z.object({ prompt: z.string().min(10).max(10000) }))
      .mutation(async ({ ctx, input }) => {
        await db.upsertSetting("system_prompt", input.prompt, "Prompt di sistema personalizzato per ADAM", ctx.user.id);
        return { success: true };
      }),

    resetPrompt: adminProcedure.mutation(async () => {
      await db.deleteSetting("system_prompt");
      return { success: true, defaultPrompt: DEFAULT_SYSTEM_PROMPT };
    }),

    getAll: adminProcedure.query(async () => {
      return db.getAllSettings();
    }),

    upsert: adminProcedure
      .input(z.object({
        key: z.string().min(1).max(100),
        value: z.string().min(1),
        description: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.upsertSetting(input.key, input.value, input.description, ctx.user.id);
        return { success: true };
      }),
  }),

  // ============ ANALYTICS ============
  analytics: router({
    stats: publicProcedure
      .input(z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      }).optional())
      .query(async ({ input }) => {
        const start = input?.startDate ? new Date(input.startDate) : undefined;
        const end = input?.endDate ? new Date(input.endDate) : undefined;
        return db.getConversationStats(start, end);
      }),

    daily: publicProcedure
      .input(z.object({ days: z.number().int().min(1).max(365).default(30) }).optional())
      .query(async ({ input }) => {
        return db.getDailyConversationCounts(input?.days ?? 30);
      }),

    crawlLogs: adminProcedure.query(async () => {
      return db.getRecentCrawlLogs();
    }),
  }),
});

export type AppRouter = typeof appRouter;
