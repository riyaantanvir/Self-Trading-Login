import { users, trades, portfolio, watchlist, type User, type InsertUser, type Trade, type InsertTrade, type Portfolio, type Watchlist } from "@shared/schema";
import { db } from "./db";
import { eq, and } from "drizzle-orm";

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserBalance(id: number, balance: number): Promise<void>;

  getTrades(userId: number): Promise<Trade[]>;
  createTrade(trade: InsertTrade & { userId: number; total: number }): Promise<Trade>;

  getPortfolio(userId: number): Promise<Portfolio[]>;
  getPortfolioItem(userId: number, symbol: string): Promise<Portfolio | undefined>;
  upsertPortfolioItem(userId: number, symbol: string, quantity: number, avgBuyPrice: number): Promise<Portfolio>;

  getWatchlist(userId: number): Promise<Watchlist[]>;
  addToWatchlist(userId: number, symbol: string): Promise<Watchlist>;
  removeFromWatchlist(userId: number, symbol: string): Promise<void>;
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

  async getTrades(userId: number): Promise<Trade[]> {
    return await db.select().from(trades).where(eq(trades.userId, userId));
  }

  async createTrade(trade: InsertTrade & { userId: number; total: number }): Promise<Trade> {
    const [newTrade] = await db.insert(trades).values(trade).returning();
    return newTrade;
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
}

export const storage = new DatabaseStorage();
