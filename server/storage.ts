import { users, trades, portfolio, watchlist, priceAlerts, type User, type InsertUser, type Trade, type InsertTrade, type Portfolio, type Watchlist, type PriceAlert } from "@shared/schema";
import { db } from "./db";
import { eq, and, gte, lt } from "drizzle-orm";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserBalance(id: number, balance: number): Promise<void>;
  getAllUsers(): Promise<User[]>;

  getTrades(userId: number): Promise<Trade[]>;
  getTradesSince(userId: number, since: Date): Promise<Trade[]>;
  createTrade(trade: InsertTrade & { userId: number; total: number }): Promise<Trade>;
  getPendingOrders(): Promise<Trade[]>;
  updateTradeStatus(tradeId: number, status: string, executedPrice?: number, executedTotal?: number): Promise<void>;
  markStopTriggered(tradeId: number): Promise<void>;

  getPortfolio(userId: number): Promise<Portfolio[]>;
  getPortfolioItem(userId: number, symbol: string): Promise<Portfolio | undefined>;
  upsertPortfolioItem(userId: number, symbol: string, quantity: number, avgBuyPrice: number): Promise<Portfolio>;

  getWatchlist(userId: number): Promise<Watchlist[]>;
  addToWatchlist(userId: number, symbol: string): Promise<Watchlist>;
  removeFromWatchlist(userId: number, symbol: string): Promise<void>;

  updateUserTelegram(id: number, telegramBotToken: string, telegramChatId: string): Promise<void>;
  updateNewsAlerts(id: number, enabled: boolean): Promise<void>;
  getUsersWithNewsAlerts(): Promise<User[]>;

  getPriceAlerts(userId: number): Promise<PriceAlert[]>;
  getActivePriceAlerts(): Promise<PriceAlert[]>;
  createPriceAlert(userId: number, data: { symbol: string; targetPrice: number; direction: string; notifyTelegram?: boolean; alertType?: string; indicator?: string; indicatorCondition?: string; chartInterval?: string }): Promise<PriceAlert>;
  deletePriceAlert(userId: number, alertId: number): Promise<void>;
  triggerPriceAlert(alertId: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUserBalance(id: number, balance: number): Promise<void> {
    await db.update(users).set({ balance }).where(eq(users.id, id));
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  async getTrades(userId: number): Promise<Trade[]> {
    return await db.select().from(trades).where(eq(trades.userId, userId));
  }

  async getTradesSince(userId: number, since: Date): Promise<Trade[]> {
    return await db.select().from(trades).where(
      and(eq(trades.userId, userId), gte(trades.timestamp, since))
    );
  }

  async createTrade(trade: InsertTrade & { userId: number; total: number }): Promise<Trade> {
    const [newTrade] = await db.insert(trades).values(trade).returning();
    return newTrade;
  }

  async getPendingOrders(): Promise<Trade[]> {
    return await db.select().from(trades).where(eq(trades.status, "pending"));
  }

  async updateTradeStatus(tradeId: number, status: string, executedPrice?: number, executedTotal?: number): Promise<void> {
    const updates: any = { status };
    if (executedPrice !== undefined) {
      updates.price = executedPrice;
    }
    if (executedTotal !== undefined) {
      updates.total = executedTotal;
    }
    await db.update(trades).set(updates).where(eq(trades.id, tradeId));
  }

  async markStopTriggered(tradeId: number): Promise<void> {
    await db.update(trades).set({ stopTriggered: 1 }).where(eq(trades.id, tradeId));
  }

  async getPortfolio(userId: number): Promise<Portfolio[]> {
    return await db.select().from(portfolio).where(eq(portfolio.userId, userId));
  }

  async getPortfolioItem(userId: number, symbol: string): Promise<Portfolio | undefined> {
    const [item] = await db.select().from(portfolio).where(
      and(eq(portfolio.userId, userId), eq(portfolio.symbol, symbol))
    );
    return item;
  }

  async upsertPortfolioItem(userId: number, symbol: string, quantity: number, avgBuyPrice: number): Promise<Portfolio> {
    const existing = await this.getPortfolioItem(userId, symbol);
    if (existing) {
      const [updated] = await db.update(portfolio)
        .set({ quantity, avgBuyPrice })
        .where(and(eq(portfolio.userId, userId), eq(portfolio.symbol, symbol)))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(portfolio)
        .values({ userId, symbol, quantity, avgBuyPrice })
        .returning();
      return created;
    }
  }
  async getWatchlist(userId: number): Promise<Watchlist[]> {
    return await db.select().from(watchlist).where(eq(watchlist.userId, userId));
  }

  async addToWatchlist(userId: number, symbol: string): Promise<Watchlist> {
    const existing = await db.select().from(watchlist).where(
      and(eq(watchlist.userId, userId), eq(watchlist.symbol, symbol))
    );
    if (existing.length > 0) return existing[0];
    const [item] = await db.insert(watchlist).values({ userId, symbol }).returning();
    return item;
  }

  async removeFromWatchlist(userId: number, symbol: string): Promise<void> {
    await db.delete(watchlist).where(
      and(eq(watchlist.userId, userId), eq(watchlist.symbol, symbol))
    );
  }
  async updateUserTelegram(id: number, telegramBotToken: string, telegramChatId: string): Promise<void> {
    await db.update(users).set({ telegramBotToken, telegramChatId }).where(eq(users.id, id));
  }

  async updateNewsAlerts(id: number, enabled: boolean): Promise<void> {
    await db.update(users).set({ newsAlertsEnabled: enabled }).where(eq(users.id, id));
  }

  async getUsersWithNewsAlerts(): Promise<User[]> {
    return await db.select().from(users).where(eq(users.newsAlertsEnabled, true));
  }

  async getPriceAlerts(userId: number): Promise<PriceAlert[]> {
    return await db.select().from(priceAlerts).where(eq(priceAlerts.userId, userId));
  }

  async getActivePriceAlerts(): Promise<PriceAlert[]> {
    return await db.select().from(priceAlerts).where(
      and(eq(priceAlerts.isActive, true), eq(priceAlerts.triggered, false))
    );
  }

  async createPriceAlert(userId: number, data: { symbol: string; targetPrice: number; direction: string; notifyTelegram?: boolean; alertType?: string; indicator?: string; indicatorCondition?: string; chartInterval?: string }): Promise<PriceAlert> {
    const [alert] = await db.insert(priceAlerts).values({
      userId,
      symbol: data.symbol,
      targetPrice: data.targetPrice,
      direction: data.direction,
      alertType: data.alertType ?? "price",
      indicator: data.indicator ?? null,
      indicatorCondition: data.indicatorCondition ?? null,
      chartInterval: data.chartInterval ?? null,
      isActive: true,
      triggered: false,
      notifyTelegram: data.notifyTelegram ?? false,
    }).returning();
    return alert;
  }

  async deletePriceAlert(userId: number, alertId: number): Promise<void> {
    await db.delete(priceAlerts).where(
      and(eq(priceAlerts.id, alertId), eq(priceAlerts.userId, userId))
    );
  }

  async triggerPriceAlert(alertId: number): Promise<void> {
    await db.update(priceAlerts).set({ triggered: true, isActive: false, triggeredAt: new Date() }).where(eq(priceAlerts.id, alertId));
  }
}

export const storage = new DatabaseStorage();
