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
  signalAlertsEnabled: boolean("signal_alerts_enabled").default(false).notNull(),
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

export const trackedCoins = pgTable("tracked_coins", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull().unique(),
});

export const insertTrackedCoinSchema = createInsertSchema(trackedCoins).omit({ id: true });
export type TrackedCoin = typeof trackedCoins.$inferSelect;
export type InsertTrackedCoin = z.infer<typeof insertTrackedCoinSchema>;

export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  keyName: text("key_name").notNull().unique(),
  apiKey: text("api_key").notNull().default(""),
  apiSecret: text("api_secret").notNull().default(""),
});

export const insertApiKeySchema = createInsertSchema(apiKeys).omit({ id: true });
export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;

export const futuresWallet = pgTable("futures_wallet", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  balance: doublePrecision("balance").default(0).notNull(),
});

export const futuresPositions = pgTable("futures_positions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  entryPrice: doublePrecision("entry_price").notNull(),
  quantity: doublePrecision("quantity").notNull(),
  leverage: integer("leverage").notNull().default(1),
  marginMode: text("margin_mode").notNull().default("cross"),
  isolatedMargin: doublePrecision("isolated_margin").default(0).notNull(),
  liquidationPrice: doublePrecision("liquidation_price").default(0).notNull(),
  status: text("status").default("open").notNull(),
  openedAt: timestamp("opened_at").defaultNow(),
  closedAt: timestamp("closed_at"),
});

export const futuresTrades = pgTable("futures_trades", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  action: text("action").notNull(),
  quantity: doublePrecision("quantity").notNull(),
  price: doublePrecision("price").notNull(),
  leverage: integer("leverage").notNull().default(1),
  marginMode: text("margin_mode").notNull().default("cross"),
  realizedPnl: doublePrecision("realized_pnl").default(0).notNull(),
  fee: doublePrecision("fee").default(0).notNull(),
  fundingFee: doublePrecision("funding_fee").default(0).notNull(),
  positionId: integer("position_id"),
  closePrice: doublePrecision("close_price"),
  timestamp: timestamp("timestamp").defaultNow(),
});

export const insertFuturesWalletSchema = createInsertSchema(futuresWallet).omit({ id: true });
export type FuturesWallet = typeof futuresWallet.$inferSelect;
export type InsertFuturesWallet = z.infer<typeof insertFuturesWalletSchema>;

export const insertFuturesPositionSchema = createInsertSchema(futuresPositions).omit({ id: true, openedAt: true, closedAt: true });
export type FuturesPosition = typeof futuresPositions.$inferSelect;
export type InsertFuturesPosition = z.infer<typeof insertFuturesPositionSchema>;

export const insertFuturesTradeSchema = createInsertSchema(futuresTrades).omit({ id: true, timestamp: true });
export type FuturesTrade = typeof futuresTrades.$inferSelect;
export type InsertFuturesTrade = z.infer<typeof insertFuturesTradeSchema>;

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

export const transfers = pgTable("transfers", {
  id: serial("id").primaryKey(),
  senderId: integer("sender_id").notNull(),
  receiverId: integer("receiver_id").notNull(),
  amount: doublePrecision("amount").notNull(),
  note: text("note").default(""),
  status: text("status").default("completed").notNull(),
  timestamp: timestamp("timestamp").defaultNow(),
});

export const insertTransferSchema = createInsertSchema(transfers).omit({ id: true, timestamp: true });
export type Transfer = typeof transfers.$inferSelect;
export type InsertTransfer = z.infer<typeof insertTransferSchema>;

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").default(false).notNull(),
  metadata: text("metadata").default(""),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({ id: true, createdAt: true });
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;

export const autopilotBots = pgTable("autopilot_bots", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull().default("buy"),
  tradeAmount: doublePrecision("trade_amount").notNull().default(10),
  strategy: text("strategy").notNull().default("custom"),
  strategyConfig: text("strategy_config").default("{}"),
  isActive: boolean("is_active").default(false).notNull(),
  totalTrades: integer("total_trades").default(0).notNull(),
  totalPnl: doublePrecision("total_pnl").default(0).notNull(),
  lastTradeAt: timestamp("last_trade_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAutopilotBotSchema = createInsertSchema(autopilotBots).omit({ id: true, userId: true, totalTrades: true, totalPnl: true, lastTradeAt: true, createdAt: true });
export type AutopilotBot = typeof autopilotBots.$inferSelect;
export type InsertAutopilotBot = z.infer<typeof insertAutopilotBotSchema>;
