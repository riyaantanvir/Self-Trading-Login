import { pgTable, text, serial, integer, boolean, timestamp, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().default(""),
  password: text("password").notNull(),
  isAdmin: boolean("is_admin").default(false).notNull(),
  balance: doublePrecision("balance").default(100000).notNull(),
  telegramBotToken: text("telegram_bot_token").default(""),
  telegramChatId: text("telegram_chat_id").default(""),
  newsAlertsEnabled: boolean("news_alerts_enabled").default(false).notNull(),
});

export const trades = pgTable("trades", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  symbol: text("symbol").notNull(),
  type: text("type").notNull(),
  quantity: doublePrecision("quantity").notNull(),
  price: doublePrecision("price").notNull(),
  total: doublePrecision("total").notNull(),
  status: text("status").default("completed").notNull(),
  orderType: text("order_type").default("market").notNull(),
  limitPrice: doublePrecision("limit_price"),
  stopPrice: doublePrecision("stop_price"),
  stopTriggered: integer("stop_triggered").default(0).notNull(),
  timestamp: timestamp("timestamp").defaultNow(),
});

export const portfolio = pgTable("portfolio", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  symbol: text("symbol").notNull(),
  quantity: doublePrecision("quantity").notNull().default(0),
  avgBuyPrice: doublePrecision("avg_buy_price").notNull().default(0),
});

export const watchlist = pgTable("watchlist", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  symbol: text("symbol").notNull(),
});

export const priceAlerts = pgTable("price_alerts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  symbol: text("symbol").notNull(),
  targetPrice: doublePrecision("target_price").notNull(),
  direction: text("direction").notNull(),
  alertType: text("alert_type").default("price").notNull(),
  indicator: text("indicator"),
  indicatorCondition: text("indicator_condition"),
  chartInterval: text("chart_interval"),
  isActive: boolean("is_active").default(true).notNull(),
  triggered: boolean("triggered").default(false).notNull(),
  notifyTelegram: boolean("notify_telegram").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  triggeredAt: timestamp("triggered_at"),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export const insertTradeSchema = createInsertSchema(trades).omit({ id: true, userId: true, timestamp: true, total: true });
export const insertPortfolioSchema = createInsertSchema(portfolio).omit({ id: true });
export const insertWatchlistSchema = createInsertSchema(watchlist).omit({ id: true });

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Trade = typeof trades.$inferSelect;
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Portfolio = typeof portfolio.$inferSelect;
export type InsertPortfolio = z.infer<typeof insertPortfolioSchema>;
export type Watchlist = typeof watchlist.$inferSelect;
export type InsertWatchlist = z.infer<typeof insertWatchlistSchema>;

export const insertPriceAlertSchema = createInsertSchema(priceAlerts).omit({ id: true, userId: true, createdAt: true, triggeredAt: true });
export type PriceAlert = typeof priceAlerts.$inferSelect;
export type InsertPriceAlert = z.infer<typeof insertPriceAlertSchema>;
