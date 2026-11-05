import { eq, desc, sql, and, gte, lte, count } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, civicNodes, conversations, messages, escalations, knowledgeBase, crawlLogs, systemSettings } from "../drizzle/schema";
import type { InsertCivicNode, InsertConversation, InsertMessage, InsertEscalation, InsertKnowledgeEntry, InsertCrawlLog } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ============ USERS ============

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }

  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    else if (user.openId === ENV.ownerOpenId) { values.role = 'admin'; updateSet.role = 'admin'; }
    if (!values.lastSignedIn) { values.lastSignedIn = new Date(); }
    if (Object.keys(updateSet).length === 0) { updateSet.lastSignedIn = new Date(); }
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export class DuplicateEmailError extends Error {
  constructor() {
    super("Email already registered");
  }
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createLocalUser(input: { email: string; name: string; passwordHash: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const openId = `local_${randomUUID()}`;
  try {
    await db.insert(users).values({
      openId,
      email: input.email,
      name: input.name,
      passwordHash: input.passwordHash,
      loginMethod: "password",
      role: ENV.ownerEmail && input.email === ENV.ownerEmail ? "admin" : "user",
      lastSignedIn: new Date(),
    });
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } });
    if (code?.code === "ER_DUP_ENTRY" || code?.cause?.code === "ER_DUP_ENTRY") {
      throw new DuplicateEmailError();
    }
    throw error;
  }

  const created = await getUserByOpenId(openId);
  if (!created) throw new Error("Failed to load created user");
  return created;
}

// ============ CIVIC NODES ============

export async function getAllNodes(type?: string) {
  const db = await getDb();
  if (!db) return [];
  if (type) {
    return db.select().from(civicNodes).where(eq(civicNodes.type, type as any));
  }
  return db.select().from(civicNodes).orderBy(desc(civicNodes.updatedAt));
}

export async function getNodeById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(civicNodes).where(eq(civicNodes.id, id)).limit(1);
  return result[0];
}

export async function createNode(node: InsertCivicNode) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(civicNodes).values(node);
  return result[0].insertId;
}

export async function updateNode(id: number, data: Partial<InsertCivicNode>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(civicNodes).set(data).where(eq(civicNodes.id, id));
}

export async function deleteNode(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(civicNodes).where(eq(civicNodes.id, id));
}

// ============ CONVERSATIONS ============

export async function createConversation(conv: InsertConversation) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(conversations).values(conv);
  return result[0].insertId;
}

export async function getConversationById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  return result[0];
}

export async function getUserConversations(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(conversations).where(eq(conversations.userId, userId)).orderBy(desc(conversations.updatedAt));
}

export async function updateConversation(id: number, data: Partial<InsertConversation>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(conversations).set(data).where(eq(conversations.id, id));
}

// ============ MESSAGES ============

export async function addMessage(msg: InsertMessage) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(messages).values(msg);
  return result[0].insertId;
}

export async function getConversationMessages(conversationId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(messages.createdAt);
}

// ============ ESCALATIONS ============

export async function createEscalation(esc: InsertEscalation) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(escalations).values(esc);
  return result[0].insertId;
}

export async function getEscalations(status?: string) {
  const db = await getDb();
  if (!db) return [];
  if (status) {
    return db.select().from(escalations).where(eq(escalations.status, status as any)).orderBy(desc(escalations.createdAt));
  }
  return db.select().from(escalations).orderBy(desc(escalations.createdAt));
}

export async function getEscalationsByOperator(operatorId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(escalations).where(eq(escalations.assignedOperatorId, operatorId)).orderBy(desc(escalations.createdAt));
}

export async function updateEscalation(id: number, data: Partial<InsertEscalation>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(escalations).set(data).where(eq(escalations.id, id));
}

// ============ KNOWLEDGE BASE ============

export async function searchKnowledge(query: string, limit = 10) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(knowledgeBase)
    .where(eq(knowledgeBase.verified, true))
    .orderBy(desc(knowledgeBase.updatedAt))
    .limit(limit);
}

export async function getAllKnowledge() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(knowledgeBase).orderBy(desc(knowledgeBase.updatedAt));
}

export async function addKnowledgeEntry(entry: InsertKnowledgeEntry) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(knowledgeBase).values(entry);
  return result[0].insertId;
}

export async function updateKnowledgeEntry(id: number, data: Partial<InsertKnowledgeEntry>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(knowledgeBase).set(data).where(eq(knowledgeBase.id, id));
}

export async function deleteKnowledgeEntry(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(knowledgeBase).where(eq(knowledgeBase.id, id));
}

// ============ CRAWL LOGS ============

export async function addCrawlLog(log: InsertCrawlLog) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(crawlLogs).values(log);
}

export async function getRecentCrawlLogs(limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(crawlLogs).orderBy(desc(crawlLogs.createdAt)).limit(limit);
}

// ============ ANALYTICS ============

export async function getConversationStats(startDate?: Date, endDate?: Date) {
  const db = await getDb();
  if (!db) return { total: 0, green: 0, yellow: 0, red: 0, totalConversations: 0, totalNodes: 0, pendingEscalations: 0, knowledgeEntries: 0, todayMessages: 0, lastCrawl: "Mai" };
  
  try {
    let conditions = [];
    if (startDate) conditions.push(gte(conversations.createdAt, startDate));
    if (endDate) conditions.push(lte(conversations.createdAt, endDate));
    
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    
    const total = await db.select({ count: count() }).from(conversations).where(whereClause);
    const green = await db.select({ count: count() }).from(conversations).where(and(eq(conversations.riskLevel, "green"), whereClause));
    const yellow = await db.select({ count: count() }).from(conversations).where(and(eq(conversations.riskLevel, "yellow"), whereClause));
    const red = await db.select({ count: count() }).from(conversations).where(and(eq(conversations.riskLevel, "red"), whereClause));
    
    // Extra stats for V.A.U.L.T. dashboard
    const nodesCount = await db.select({ count: count() }).from(civicNodes);
    const escalationsCount = await db.select({ count: count() }).from(escalations).where(eq(escalations.status, "pending"));
    const kbCount = await db.select({ count: count() }).from(knowledgeBase);
    
    // Today's messages
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMsgs = await db.select({ count: count() }).from(messages).where(gte(messages.createdAt, today));
    
    // Last crawl
    const lastCrawlResult = await db.select({ createdAt: crawlLogs.createdAt }).from(crawlLogs).orderBy(desc(crawlLogs.createdAt)).limit(1);
    const lastCrawlDate = lastCrawlResult.length > 0 ? lastCrawlResult[0].createdAt?.toLocaleDateString("it-IT") : "Mai";
    
    return {
      total: total[0]?.count ?? 0,
      green: green[0]?.count ?? 0,
      yellow: yellow[0]?.count ?? 0,
      red: red[0]?.count ?? 0,
      totalConversations: total[0]?.count ?? 0,
      totalNodes: nodesCount[0]?.count ?? 0,
      pendingEscalations: escalationsCount[0]?.count ?? 0,
      knowledgeEntries: kbCount[0]?.count ?? 0,
      todayMessages: todayMsgs[0]?.count ?? 0,
      lastCrawl: lastCrawlDate ?? "Mai",
    };
  } catch (error) {
    console.warn("[Analytics] getConversationStats failed:", error);
    return { total: 0, green: 0, yellow: 0, red: 0, totalConversations: 0, totalNodes: 0, pendingEscalations: 0, knowledgeEntries: 0, todayMessages: 0, lastCrawl: "Mai" };
  }
}

export async function getDailyConversationCounts(days = 30) {
  const db = await getDb();
  if (!db) return [];
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().slice(0, 10);
  
  try {
    // Use raw SQL string to avoid only_full_group_by issues with parameterized DATE comparison
    const result = await db.execute(
      sql.raw(`SELECT DATE(createdAt) AS date, COUNT(*) AS count FROM conversations WHERE createdAt >= '${startDateStr}' GROUP BY DATE(createdAt) ORDER BY DATE(createdAt)`)
    );
    
    // result structure from mysql2 execute
    const rows = Array.isArray(result) ? (Array.isArray(result[0]) ? result[0] : result) : [];
    if (Array.isArray(rows) && rows.length > 0 && typeof rows[0] === 'object') {
      return (rows as any[]).map((row: any) => ({
        date: row.date ? String(row.date) : '',
        count: Number(row.count || 0),
      })).filter(r => r.date);
    }
    return [];
  } catch (error) {
    console.warn("[Analytics] getDailyConversationCounts failed:", error);
    return [];
  }
}

// ============ SYSTEM SETTINGS ============

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(systemSettings).where(eq(systemSettings.key, key)).limit(1);
  return result.length > 0 ? result[0].value : null;
}

export async function getAllSettings() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(systemSettings).orderBy(systemSettings.key);
}

export async function upsertSetting(key: string, value: string, description?: string, updatedBy?: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(systemSettings).values({ key, value, description, updatedBy })
    .onDuplicateKeyUpdate({ set: { value, description, updatedBy } });
}

export async function deleteSetting(key: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(systemSettings).where(eq(systemSettings.key, key));
}
