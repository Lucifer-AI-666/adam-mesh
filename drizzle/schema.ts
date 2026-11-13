import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, json, decimal, boolean } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }).unique(),
  passwordHash: varchar("passwordHash", { length: 255 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "operator", "admin"]).default("user").notNull(),
  assignedNodeId: int("assignedNodeId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Civic nodes - uffici, attività, turismo, associazioni
 */
export const civicNodes = mysqlTable("civic_nodes", {
  id: int("id").autoincrement().primaryKey(),
  type: mysqlEnum("type", ["institutional", "commercial", "tourism", "association", "services"]).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  category: varchar("category", { length: 100 }),
  description: text("description"),
  address: text("address"),
  lat: decimal("lat", { precision: 10, scale: 8 }),
  lng: decimal("lng", { precision: 11, scale: 8 }),
  phone: varchar("phone", { length: 50 }),
  email: varchar("email", { length: 320 }),
  website: varchar("website", { length: 500 }),
  hours: json("hours"),
  services: json("services"),
  trustLevel: mysqlEnum("trustLevel", ["pending", "verified", "suspended"]).default("pending").notNull(),
  operatorUserId: int("operatorUserId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CivicNode = typeof civicNodes.$inferSelect;
export type InsertCivicNode = typeof civicNodes.$inferInsert;

/**
 * Conversations - storico chat
 */
export const conversations = mysqlTable("conversations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  channel: mysqlEnum("channel", ["web", "whatsapp", "telegram"]).default("web").notNull(),
  riskLevel: mysqlEnum("riskLevel", ["green", "yellow", "red"]),
  status: mysqlEnum("status", ["active", "escalated", "resolved", "closed"]).default("active").notNull(),
  title: varchar("title", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  resolvedAt: timestamp("resolvedAt"),
});

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = typeof conversations.$inferInsert;

/**
 * Messages - singoli messaggi nelle conversazioni
 */
export const messages = mysqlTable("messages", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull(),
  role: mysqlEnum("role", ["user", "assistant", "operator", "system"]).notNull(),
  content: text("content").notNull(),
  riskLevel: mysqlEnum("riskLevel", ["green", "yellow", "red"]),
  sources: json("sources"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;

/**
 * Escalations - richieste instradate agli operatori
 */
export const escalations = mysqlTable("escalations", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull(),
  assignedNodeId: int("assignedNodeId"),
  assignedOperatorId: int("assignedOperatorId"),
  reason: text("reason"),
  context: text("context"),
  status: mysqlEnum("status", ["pending", "in_progress", "resolved"]).default("pending").notNull(),
  notificationSent: boolean("notificationSent").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  resolvedAt: timestamp("resolvedAt"),
});

export type Escalation = typeof escalations.$inferSelect;
export type InsertEscalation = typeof escalations.$inferInsert;

/**
 * Knowledge base - fonti verificate per le risposte AI
 */
export const knowledgeBase = mysqlTable("knowledge_base", {
  id: int("id").autoincrement().primaryKey(),
  sourceNodeId: int("sourceNodeId"),
  category: varchar("category", { length: 100 }),
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content").notNull(),
  sourceUrl: varchar("sourceUrl", { length: 500 }),
  verified: boolean("verified").default(false),
  validUntil: timestamp("validUntil"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type KnowledgeEntry = typeof knowledgeBase.$inferSelect;
export type InsertKnowledgeEntry = typeof knowledgeBase.$inferInsert;

/**
 * Crawl logs - log del crawling automatico
 */
export const crawlLogs = mysqlTable("crawl_logs", {
  id: int("id").autoincrement().primaryKey(),
  url: varchar("url", { length: 500 }).notNull(),
  status: mysqlEnum("status", ["success", "error", "skipped"]).notNull(),
  entriesAdded: int("entriesAdded").default(0),
  entriesUpdated: int("entriesUpdated").default(0),
  errorMessage: text("errorMessage"),
  scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CrawlLog = typeof crawlLogs.$inferSelect;
export type InsertCrawlLog = typeof crawlLogs.$inferInsert;

/**
 * System settings - configurazione ADAM (prompt, parametri)
 */
export const systemSettings = mysqlTable("system_settings", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 100 }).notNull().unique(),
  value: text("value").notNull(),
  description: varchar("description", { length: 500 }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  updatedBy: int("updatedBy"),
});

export type SystemSetting = typeof systemSettings.$inferSelect;
export type InsertSystemSetting = typeof systemSettings.$inferInsert;
