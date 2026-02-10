import { users, trades, portfolio, watchlist, priceAlerts, trackedCoins, apiKeys, futuresWallet, futuresPositions, futuresTrades, transfers, notifications, type User, type InsertUser, type Trade, type InsertTrade, type Portfolio, type Watchlist, type PriceAlert, type TrackedCoin, type ApiKey, type FuturesWallet, type FuturesPosition, type FuturesTrade, type Transfer, type Notification } from "@shared/schema";
import { db } from "./db";
import { eq, and, gte, lt, or, ilike } from "drizzle-orm";

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
  updateSignalAlerts(id: number, enabled: boolean): Promise<void>;
  getUsersWithSignalAlerts(): Promise<User[]>;

  getTrackedCoins(): Promise<TrackedCoin[]>;
  addTrackedCoin(symbol: string): Promise<TrackedCoin>;
  removeTrackedCoin(symbol: string): Promise<void>;

  getApiKey(keyName: string): Promise<ApiKey | undefined>;
  getAllApiKeys(): Promise<ApiKey[]>;
  upsertApiKey(keyName: string, apiKeyVal: string, apiSecret: string): Promise<ApiKey>;

  getFuturesWallet(userId: number): Promise<FuturesWallet | undefined>;
  createFuturesWallet(userId: number, balance: number): Promise<FuturesWallet>;
  updateFuturesWalletBalance(userId: number, balance: number): Promise<void>;

  getFuturesPositions(userId: number): Promise<FuturesPosition[]>;
  getOpenFuturesPositions(userId: number): Promise<FuturesPosition[]>;
  getFuturesPosition(id: number): Promise<FuturesPosition | undefined>;
  createFuturesPosition(data: { userId: number; symbol: string; side: string; entryPrice: number; quantity: number; leverage: number; marginMode: string; isolatedMargin: number; liquidationPrice: number }): Promise<FuturesPosition>;
  closeFuturesPosition(id: number): Promise<void>;
  updateFuturesPositionQuantity(id: number, quantity: number, entryPrice: number): Promise<void>;

  getFuturesTrades(userId: number): Promise<FuturesTrade[]>;
  createFuturesTrade(data: { userId: number; symbol: string; side: string; action: string; quantity: number; price: number; leverage: number; marginMode: string; realizedPnl: number; fee: number }): Promise<FuturesTrade>;

  searchUsers(query: string, currentUserId: number): Promise<{ id: number; username: string }[]>;
  createTransfer(senderId: number, receiverId: number, amount: number, note: string): Promise<Transfer>;
  getTransfers(userId: number): Promise<Transfer[]>;

  getPriceAlerts(userId: number): Promise<PriceAlert[]>;
  getActivePriceAlerts(): Promise<PriceAlert[]>;
  createPriceAlert(userId: number, data: { symbol: string; targetPrice: number; direction: string; notifyTelegram?: boolean; alertType?: string; indicator?: string; indicatorCondition?: string; chartInterval?: string }): Promise<PriceAlert>;
  deletePriceAlert(userId: number, alertId: number): Promise<void>;
  triggerPriceAlert(alertId: number): Promise<void>;

  getNotifications(userId: number): Promise<Notification[]>;
  getUnreadNotificationCount(userId: number): Promise<number>;
  createNotification(userId: number, type: string, title: string, message: string, metadata?: string): Promise<Notification>;
  markNotificationRead(userId: number, notificationId: number): Promise<void>;
  markAllNotificationsRead(userId: number): Promise<void>;
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

  async updateSignalAlerts(id: number, enabled: boolean): Promise<void> {
    await db.update(users).set({ signalAlertsEnabled: enabled }).where(eq(users.id, id));
  }

  async getUsersWithSignalAlerts(): Promise<User[]> {
    return await db.select().from(users).where(eq(users.signalAlertsEnabled, true));
  }

  async getTrackedCoins(): Promise<TrackedCoin[]> {
    return await db.select().from(trackedCoins);
  }

  async addTrackedCoin(symbol: string): Promise<TrackedCoin> {
    const existing = await db.select().from(trackedCoins).where(eq(trackedCoins.symbol, symbol));
    if (existing.length > 0) return existing[0];
    const [coin] = await db.insert(trackedCoins).values({ symbol }).returning();
    return coin;
  }

  async removeTrackedCoin(symbol: string): Promise<void> {
    await db.delete(trackedCoins).where(eq(trackedCoins.symbol, symbol));
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

  async getApiKey(keyName: string): Promise<ApiKey | undefined> {
    const [key] = await db.select().from(apiKeys).where(eq(apiKeys.keyName, keyName));
    return key;
  }

  async getAllApiKeys(): Promise<ApiKey[]> {
    return await db.select().from(apiKeys);
  }

  async upsertApiKey(keyName: string, apiKeyVal: string, apiSecret: string): Promise<ApiKey> {
    const existing = await this.getApiKey(keyName);
    if (existing) {
      const [updated] = await db.update(apiKeys)
        .set({ apiKey: apiKeyVal, apiSecret: apiSecret })
        .where(eq(apiKeys.keyName, keyName))
        .returning();
      return updated;
    }
    const [created] = await db.insert(apiKeys)
      .values({ keyName, apiKey: apiKeyVal, apiSecret: apiSecret })
      .returning();
    return created;
  }

  async getFuturesWallet(userId: number): Promise<FuturesWallet | undefined> {
    const [wallet] = await db.select().from(futuresWallet).where(eq(futuresWallet.userId, userId));
    return wallet;
  }

  async createFuturesWallet(userId: number, balance: number): Promise<FuturesWallet> {
    const existing = await this.getFuturesWallet(userId);
    if (existing) {
      await db.update(futuresWallet).set({ balance }).where(eq(futuresWallet.userId, userId));
      return { ...existing, balance };
    }
    const [wallet] = await db.insert(futuresWallet).values({ userId, balance }).returning();
    return wallet;
  }

  async updateFuturesWalletBalance(userId: number, balance: number): Promise<void> {
    await db.update(futuresWallet).set({ balance }).where(eq(futuresWallet.userId, userId));
  }

  async getFuturesPositions(userId: number): Promise<FuturesPosition[]> {
    return await db.select().from(futuresPositions).where(eq(futuresPositions.userId, userId));
  }

  async getOpenFuturesPositions(userId: number): Promise<FuturesPosition[]> {
    return await db.select().from(futuresPositions).where(
      and(eq(futuresPositions.userId, userId), eq(futuresPositions.status, "open"))
    );
  }

  async getFuturesPosition(id: number): Promise<FuturesPosition | undefined> {
    const [pos] = await db.select().from(futuresPositions).where(eq(futuresPositions.id, id));
    return pos;
  }

  async createFuturesPosition(data: { userId: number; symbol: string; side: string; entryPrice: number; quantity: number; leverage: number; marginMode: string; isolatedMargin: number; liquidationPrice: number }): Promise<FuturesPosition> {
    const [pos] = await db.insert(futuresPositions).values({
      userId: data.userId,
      symbol: data.symbol,
      side: data.side,
      entryPrice: data.entryPrice,
      quantity: data.quantity,
      leverage: data.leverage,
      marginMode: data.marginMode,
      isolatedMargin: data.isolatedMargin,
      liquidationPrice: data.liquidationPrice,
      status: "open",
    }).returning();
    return pos;
  }

  async closeFuturesPosition(id: number): Promise<void> {
    await db.update(futuresPositions).set({ status: "closed", closedAt: new Date() }).where(eq(futuresPositions.id, id));
  }

  async updateFuturesPositionQuantity(id: number, quantity: number, entryPrice: number): Promise<void> {
    await db.update(futuresPositions).set({ quantity, entryPrice }).where(eq(futuresPositions.id, id));
  }

  async getFuturesTrades(userId: number): Promise<FuturesTrade[]> {
    return await db.select().from(futuresTrades).where(eq(futuresTrades.userId, userId));
  }

  async createFuturesTrade(data: { userId: number; symbol: string; side: string; action: string; quantity: number; price: number; leverage: number; marginMode: string; realizedPnl: number; fee: number }): Promise<FuturesTrade> {
    const [trade] = await db.insert(futuresTrades).values(data).returning();
    return trade;
  }

  async searchUsers(query: string, currentUserId: number): Promise<{ id: number; username: string }[]> {
    const results = await db.select({ id: users.id, username: users.username })
      .from(users)
      .where(ilike(users.username, `%${query}%`));
    return results.filter(u => u.id !== currentUserId);
  }

  async createTransfer(senderId: number, receiverId: number, amount: number, note: string): Promise<Transfer> {
    return await db.transaction(async (tx) => {
      const [sender] = await tx.select().from(users).where(eq(users.id, senderId));
      if (!sender || sender.balance < amount) {
        throw new Error("Insufficient balance");
      }

      const [receiver] = await tx.select().from(users).where(eq(users.id, receiverId));
      if (!receiver) {
        throw new Error("Recipient not found");
      }

      await tx.update(users).set({ balance: sender.balance - amount }).where(eq(users.id, senderId));
      await tx.update(users).set({ balance: receiver.balance + amount }).where(eq(users.id, receiverId));

      const [transfer] = await tx.insert(transfers).values({
        senderId,
        receiverId,
        amount,
        note: note || "",
        status: "completed",
      }).returning();

      return transfer;
    });
  }

  async getTransfers(userId: number): Promise<Transfer[]> {
    return await db.select().from(transfers).where(
      or(eq(transfers.senderId, userId), eq(transfers.receiverId, userId))
    );
  }

  async getNotifications(userId: number): Promise<Notification[]> {
    return await db.select().from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(notifications.createdAt);
  }

  async getUnreadNotificationCount(userId: number): Promise<number> {
    const result = await db.select().from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
    return result.length;
  }

  async createNotification(userId: number, type: string, title: string, message: string, metadata?: string): Promise<Notification> {
    const [notification] = await db.insert(notifications).values({
      userId,
      type,
      title,
      message,
      isRead: false,
      metadata: metadata || "",
    }).returning();
    return notification;
  }

  async markNotificationRead(userId: number, notificationId: number): Promise<void> {
    await db.update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)));
  }

  async markAllNotificationsRead(userId: number): Promise<void> {
    await db.update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.userId, userId));
  }
}

export const storage = new DatabaseStorage();
