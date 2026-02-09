import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { setupAuth, hashPassword } from "./auth";
import { z } from "zod";
import { WebSocketServer, WebSocket } from "ws";

async function sendTelegramMessage(botToken: string, chatId: string, message: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML" }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      const description = errBody?.description || `HTTP ${res.status}`;
      console.error("[Telegram] Failed to send:", description);
      return { ok: false, error: description };
    }
    return { ok: true };
  } catch (err: any) {
    console.error("[Telegram] Error:", err);
    return { ok: false, error: err.message || "Network error" };
  }
}

const TRACKED_SYMBOLS = [
  "btcusdt", "ethusdt", "bnbusdt", "xrpusdt", "solusdt",
  "adausdt", "dogeusdt", "dotusdt", "trxusdt", "linkusdt",
  "avaxusdt", "uniusdt", "ltcusdt", "atomusdt", "etcusdt",
  "xlmusdt", "nearusdt", "algousdt", "filusdt", "polusdt",
];

interface TickerData {
  symbol: string;
  lastPrice: string;
  openPrice: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
}

const tickerMap = new Map<string, TickerData>();

function setupBinanceLiveStream(httpServer: Server) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws/market" });
  const clients = new Set<WebSocket>();
  let binanceWs: WebSocket | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let broadcastInterval: NodeJS.Timeout | null = null;
  let binanceConnected = false;

  function connectBinance() {
    if (binanceWs) {
      try { binanceWs.close(); } catch {}
      binanceWs = null;
    }

    const streams = TRACKED_SYMBOLS.map(s => `${s}@miniTicker`).join("/");
    const url = `wss://data-stream.binance.vision/stream?streams=${streams}`;

    try {
      binanceWs = new WebSocket(url);

      binanceWs.on("open", () => {
        console.log("[Binance WS] Connected to data-stream.binance.vision");
        binanceConnected = true;
        broadcast({ type: "status", connected: true });
      });

      binanceWs.on("message", (rawData) => {
        try {
          const msg = JSON.parse(rawData.toString());
          const d = msg.data;
          if (!d || !d.s) return;

          const symbol = d.s;
          const openPrice = parseFloat(d.o);
          const closePrice = parseFloat(d.c);
          const changePercent = openPrice > 0 ? ((closePrice - openPrice) / openPrice) * 100 : 0;

          tickerMap.set(symbol, {
            symbol,
            lastPrice: d.c,
            openPrice: d.o,
            priceChangePercent: changePercent.toFixed(2),
            highPrice: d.h,
            lowPrice: d.l,
            volume: d.v,
            quoteVolume: d.q,
          });
        } catch {}
      });

      binanceWs.on("error", (err) => {
        console.error("[Binance WS] Error:", (err as any).message);
        binanceConnected = false;
      });

      binanceWs.on("close", () => {
        console.log("[Binance WS] Disconnected, reconnecting in 3s...");
        binanceConnected = false;
        binanceWs = null;
        broadcast({ type: "status", connected: false });
        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connectBinance();
          }, 3000);
        }
      });
    } catch (err) {
      console.error("[Binance WS] Failed:", err);
      binanceConnected = false;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectBinance();
      }, 5000);
    }
  }

  function broadcast(data: any) {
    const msg = JSON.stringify(data);
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  }

  broadcastInterval = setInterval(() => {
    if (tickerMap.size === 0) return;
    const tickers = Array.from(tickerMap.values());
    broadcast({ type: "tickers", data: tickers });
  }, 1000);

  async function triggerAlertAndNotify(alert: any, currentPrice: number, extraInfo?: string) {
    await storage.triggerPriceAlert(alert.id);
    broadcast({
      type: "alert_triggered",
      data: {
        id: alert.id,
        userId: alert.userId,
        symbol: alert.symbol,
        targetPrice: alert.targetPrice,
        direction: alert.direction,
        alertType: alert.alertType,
        currentPrice,
      },
    });

    if (alert.notifyTelegram) {
      try {
        const alertUser = await storage.getUser(alert.userId);
        if (alertUser?.telegramBotToken && alertUser?.telegramChatId) {
          const coin = alert.symbol.replace("USDT", "");
          let msg: string;
          if (alert.alertType === "indicator") {
            const condLabel = alert.indicatorCondition === "bb_upper" ? "Upper Band" : "Lower Band";
            msg = `<b>Indicator Alert Triggered!</b>\n\n` +
              `<b>${coin}/USDT</b> - Bollinger Band ${condLabel} hit!\n` +
              `Timeframe: ${alert.chartInterval}\n` +
              `Current Price: $${Number(currentPrice).toLocaleString()}\n` +
              (extraInfo ? `${extraInfo}\n` : "") +
              `\n- Self Treding`;
          } else {
            msg = `<b>Price Alert Triggered!</b>\n\n` +
              `<b>${coin}/USDT</b> is now ${alert.direction === "above" ? "above" : "below"} your target.\n\n` +
              `Target: $${Number(alert.targetPrice).toLocaleString()}\n` +
              `Current: $${Number(currentPrice).toLocaleString()}\n\n` +
              `- Self Treding`;
          }
          await sendTelegramMessage(alertUser.telegramBotToken, alertUser.telegramChatId, msg);
        }
      } catch (tgErr) {
        console.error("[Telegram] Alert notification error:", tgErr);
      }
    }
  }

  setInterval(async () => {
    if (tickerMap.size === 0) return;
    try {
      const activeAlerts = await storage.getActivePriceAlerts();
      const priceAlerts = activeAlerts.filter(a => a.alertType === "price");
      for (const alert of priceAlerts) {
        const ticker = tickerMap.get(alert.symbol);
        if (!ticker) continue;
        const currentPrice = parseFloat(ticker.lastPrice);
        const shouldTrigger =
          (alert.direction === "above" && currentPrice >= alert.targetPrice) ||
          (alert.direction === "below" && currentPrice <= alert.targetPrice);
        if (shouldTrigger) {
          await triggerAlertAndNotify(alert, currentPrice);
        }
      }
    } catch (err) {
      console.error("[Alert Check] Error:", err);
    }
  }, 3000);

  function computeBBServer(closes: number[], period = 20, multiplier = 2) {
    if (closes.length < period) return null;
    const recent = closes.slice(-period);
    const sma = recent.reduce((s, v) => s + v, 0) / period;
    const variance = recent.reduce((s, v) => s + (v - sma) ** 2, 0) / period;
    const stdDev = Math.sqrt(variance);
    return { upper: sma + multiplier * stdDev, middle: sma, lower: sma - multiplier * stdDev };
  }

  const klineCache = new Map<string, { data: number[]; ts: number }>();

  async function fetchKlineCloses(symbol: string, interval: string): Promise<number[]> {
    const key = `${symbol}_${interval}`;
    const cached = klineCache.get(key);
    if (cached && Date.now() - cached.ts < 30000) return cached.data;
    try {
      const url = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=50`;
      const res = await fetch(url);
      if (!res.ok) return cached?.data || [];
      const raw = await res.json();
      const closes = raw.map((k: any) => parseFloat(k[4]));
      klineCache.set(key, { data: closes, ts: Date.now() });
      return closes;
    } catch {
      return cached?.data || [];
    }
  }

  setInterval(async () => {
    try {
      const activeAlerts = await storage.getActivePriceAlerts();
      const indicatorAlerts = activeAlerts.filter(a => a.alertType === "indicator");
      if (indicatorAlerts.length === 0) return;

      const grouped = new Map<string, typeof indicatorAlerts>();
      for (const alert of indicatorAlerts) {
        const key = `${alert.symbol}_${alert.chartInterval || "1h"}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(alert);
      }

      for (const [key, alerts] of grouped) {
        const [symbol, interval] = key.split("_");
        const closes = await fetchKlineCloses(symbol, interval);
        if (closes.length < 20) continue;

        const bb = computeBBServer(closes);
        if (!bb) continue;

        const currentPrice = closes[closes.length - 1];

        for (const alert of alerts) {
          if (alert.indicator === "bollinger_bands") {
            let shouldTrigger = false;
            let extraInfo = "";
            if (alert.indicatorCondition === "bb_upper" && currentPrice >= bb.upper) {
              shouldTrigger = true;
              extraInfo = `BB Upper: $${bb.upper.toFixed(2)}`;
            } else if (alert.indicatorCondition === "bb_lower" && currentPrice <= bb.lower) {
              shouldTrigger = true;
              extraInfo = `BB Lower: $${bb.lower.toFixed(2)}`;
            }
            if (shouldTrigger) {
              await triggerAlertAndNotify(alert, currentPrice, extraInfo);
            }
          }
        }
      }
    } catch (err) {
      console.error("[Indicator Alert Check] Error:", err);
    }
  }, 30000);

  setInterval(async () => {
    if (tickerMap.size === 0) return;
    try {
      const pendingOrders = await storage.getPendingOrders();
      for (const order of pendingOrders) {
        const ticker = tickerMap.get(order.symbol);
        if (!ticker) continue;
        const currentPrice = parseFloat(ticker.lastPrice);

        let shouldExecute = false;

        if (order.orderType === "limit") {
          if (order.type === "buy" && currentPrice <= (order.limitPrice || 0)) shouldExecute = true;
          if (order.type === "sell" && currentPrice >= (order.limitPrice || 0)) shouldExecute = true;
        } else if (order.orderType === "stop_market") {
          if (order.type === "buy" && currentPrice >= (order.stopPrice || 0)) shouldExecute = true;
          if (order.type === "sell" && currentPrice <= (order.stopPrice || 0)) shouldExecute = true;
        } else if (order.orderType === "stop_limit") {
          if (order.stopTriggered) {
            if (order.type === "buy" && currentPrice <= (order.limitPrice || 0)) shouldExecute = true;
            if (order.type === "sell" && currentPrice >= (order.limitPrice || 0)) shouldExecute = true;
          } else {
            const stopHit =
              (order.type === "buy" && currentPrice >= (order.stopPrice || 0)) ||
              (order.type === "sell" && currentPrice <= (order.stopPrice || 0));
            if (stopHit) {
              await storage.markStopTriggered(order.id);
              console.log(`[Order] Stop triggered for order ${order.id} ${order.type} ${order.symbol} at $${currentPrice}`);
              if (order.type === "buy" && currentPrice <= (order.limitPrice || 0)) shouldExecute = true;
              if (order.type === "sell" && currentPrice >= (order.limitPrice || 0)) shouldExecute = true;
            }
          }
        }

        if (shouldExecute) {
          try {
            const execPrice = (order.orderType === "limit" || order.orderType === "stop_limit") ? (order.limitPrice || currentPrice) : currentPrice;
            const total = order.quantity * execPrice;
            const user = await storage.getUser(order.userId);
            if (!user) continue;

            if (order.type === "buy") {
              const existing = await storage.getPortfolioItem(user.id, order.symbol);
              if (existing) {
                const newQty = existing.quantity + order.quantity;
                const newAvg = ((existing.avgBuyPrice * existing.quantity) + total) / newQty;
                await storage.upsertPortfolioItem(user.id, order.symbol, newQty, newAvg);
              } else {
                await storage.upsertPortfolioItem(user.id, order.symbol, order.quantity, execPrice);
              }
              const reservedTotal = order.quantity * (order.limitPrice || order.price);
              const refundDiff = reservedTotal - total;
              if (refundDiff > 0) {
                await storage.updateUserBalance(user.id, user.balance + refundDiff);
              }
            } else {
              await storage.updateUserBalance(user.id, user.balance + total);
            }

            await storage.updateTradeStatus(order.id, "completed", execPrice, total);
            console.log(`[Order Execution] ${order.orderType} ${order.type} ${order.symbol} executed at $${execPrice}`);
          } catch (execErr) {
            console.error(`[Order Execution] Error executing order ${order.id}:`, execErr);
          }
        }
      }
    } catch (err) {
      console.error("[Pending Order Check] Error:", err);
    }
  }, 3000);

  connectBinance();

  wss.on("connection", (ws) => {
    clients.add(ws);

    ws.send(JSON.stringify({ type: "status", connected: binanceConnected }));

    if (tickerMap.size > 0) {
      ws.send(JSON.stringify({ type: "tickers", data: Array.from(tickerMap.values()) }));
    }

    ws.on("close", () => {
      clients.delete(ws);
    });
  });

  return wss;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  setupAuth(app);

  const existingAdmin = await storage.getUserByUsername("Admin");
  if (!existingAdmin) {
    const hashedPassword = await hashPassword("Admin");
    await storage.createUser({
      username: "Admin",
      password: hashedPassword,
      isAdmin: true,
      balance: 100000,
    });
    console.log("Admin user seeded");
  }

  setupBinanceLiveStream(httpServer);

  app.get("/api/market/tickers", async (_req, res) => {
    try {
      if (tickerMap.size > 0) {
        res.json(Array.from(tickerMap.values()));
        return;
      }
      res.json([]);
    } catch (err) {
      console.error("Market data error:", err);
      res.status(502).json({ message: "Failed to fetch market data" });
    }
  });

  app.get("/api/market/klines", async (req, res) => {
    try {
      const symbol = (req.query.symbol as string || "BTCUSDT").toUpperCase();
      const interval = (req.query.interval as string) || "1h";
      const limit = Math.min(parseInt(req.query.limit as string) || 500, 1000);

      const url = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const response = await fetch(url);
      if (!response.ok) {
        return res.status(502).json({ message: "Failed to fetch klines" });
      }
      const data = await response.json();
      const klines = (data as any[]).map((k: any) => ({
        time: Math.floor(k[0] / 1000),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }));
      res.json(klines);
    } catch (err) {
      console.error("Klines error:", err);
      res.status(502).json({ message: "Failed to fetch klines" });
    }
  });

  app.get("/api/trades", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const userTrades = await storage.getTrades(req.user!.id);
    res.json(userTrades);
  });

  app.post("/api/trades", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const tradeSchema = z.object({
        symbol: z.string(),
        type: z.enum(["buy", "sell"]),
        quantity: z.coerce.number().positive(),
        price: z.coerce.number().positive(),
        orderType: z.enum(["market", "limit", "stop_limit", "stop_market"]).default("market"),
        limitPrice: z.coerce.number().positive().optional(),
        stopPrice: z.coerce.number().positive().optional(),
      });
      const data = tradeSchema.parse(req.body);
      const user = req.user!;

      if (data.orderType === "limit" && !data.limitPrice) {
        return res.status(400).json({ message: "Limit price is required for limit orders" });
      }
      if (data.orderType === "stop_market" && !data.stopPrice) {
        return res.status(400).json({ message: "Stop price is required for stop market orders" });
      }
      if (data.orderType === "stop_limit" && (!data.limitPrice || !data.stopPrice)) {
        return res.status(400).json({ message: "Both limit price and stop price are required for stop limit orders" });
      }

      const execPrice = data.orderType === "limit" ? data.limitPrice! : data.price;
      const total = data.quantity * execPrice;

      if (total < 5) {
        return res.status(400).json({ message: "Minimum order amount is 5 USDT" });
      }

      if (data.orderType !== "market") {
        if (data.type === "buy") {
          const reserveTotal = data.quantity * (data.limitPrice || data.price);
          if (user.balance < reserveTotal) {
            return res.status(400).json({ message: "Insufficient balance" });
          }
          await storage.updateUserBalance(user.id, user.balance - reserveTotal);
        } else {
          const existing = await storage.getPortfolioItem(user.id, data.symbol);
          if (!existing || existing.quantity < data.quantity) {
            return res.status(400).json({ message: "Insufficient holdings" });
          }
          const newQty = existing.quantity - data.quantity;
          if (newQty <= 0) {
            await storage.upsertPortfolioItem(user.id, data.symbol, 0, 0);
          } else {
            await storage.upsertPortfolioItem(user.id, data.symbol, newQty, existing.avgBuyPrice);
          }
        }

        const trade = await storage.createTrade({
          symbol: data.symbol,
          type: data.type,
          quantity: data.quantity,
          price: data.price,
          userId: user.id,
          total,
          status: "pending",
          orderType: data.orderType,
          limitPrice: data.limitPrice || null,
          stopPrice: data.stopPrice || null,
        });

        const updatedUser = await storage.getUser(user.id);
        res.status(201).json({ trade, user: updatedUser });
        return;
      }

      if (data.type === "buy") {
        if (user.balance < total) {
          return res.status(400).json({ message: "Insufficient balance" });
        }
        await storage.updateUserBalance(user.id, user.balance - total);

        const existing = await storage.getPortfolioItem(user.id, data.symbol);
        if (existing) {
          const newQty = existing.quantity + data.quantity;
          const newAvg = ((existing.avgBuyPrice * existing.quantity) + total) / newQty;
          await storage.upsertPortfolioItem(user.id, data.symbol, newQty, newAvg);
        } else {
          await storage.upsertPortfolioItem(user.id, data.symbol, data.quantity, data.price);
        }
      } else {
        const existing = await storage.getPortfolioItem(user.id, data.symbol);
        if (!existing || existing.quantity < data.quantity) {
          return res.status(400).json({ message: "Insufficient holdings" });
        }
        await storage.updateUserBalance(user.id, user.balance + total);
        const newQty = existing.quantity - data.quantity;
        if (newQty <= 0) {
          await storage.upsertPortfolioItem(user.id, data.symbol, 0, 0);
        } else {
          await storage.upsertPortfolioItem(user.id, data.symbol, newQty, existing.avgBuyPrice);
        }
      }

      const trade = await storage.createTrade({
        symbol: data.symbol,
        type: data.type,
        quantity: data.quantity,
        price: data.price,
        userId: user.id,
        total,
        status: "completed",
        orderType: "market",
      });

      const updatedUser = await storage.getUser(user.id);
      res.status(201).json({ trade, user: updatedUser });
    } catch (e) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ message: e.errors[0].message });
      }
      console.error("Trade error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/trades/pending", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const allPending = await storage.getPendingOrders();
    const userPending = allPending.filter(t => t.userId === req.user!.id);
    res.json(userPending);
  });

  app.delete("/api/trades/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const tradeId = parseInt(req.params.id);
    const allPending = await storage.getPendingOrders();
    const order = allPending.find(t => t.id === tradeId && t.userId === req.user!.id);
    if (!order) {
      return res.status(404).json({ message: "Pending order not found" });
    }

    if (order.type === "buy") {
      const refund = order.quantity * (order.limitPrice || order.price);
      const user = await storage.getUser(order.userId);
      if (user) {
        await storage.updateUserBalance(user.id, user.balance + refund);
      }
    } else {
      const user = await storage.getUser(order.userId);
      if (user) {
        const existing = await storage.getPortfolioItem(user.id, order.symbol);
        const currentQty = existing ? existing.quantity : 0;
        const avgPrice = existing ? existing.avgBuyPrice : order.price;
        await storage.upsertPortfolioItem(user.id, order.symbol, currentQty + order.quantity, avgPrice);
      }
    }

    await storage.updateTradeStatus(tradeId, "cancelled");
    res.json({ message: "Order cancelled" });
  });

  app.get("/api/portfolio", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const items = await storage.getPortfolio(req.user!.id);
    res.json(items.filter(i => i.quantity > 0));
  });

  app.get("/api/portfolio/today-pnl", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const freshUser = await storage.getUser(req.user!.id);
      if (!freshUser) return res.sendStatus(401);

      const now = new Date();
      const todayStart = new Date(now);
      todayStart.setHours(6, 0, 0, 0);
      if (now.getHours() < 6) {
        todayStart.setDate(todayStart.getDate() - 1);
      }

      const todayTrades = await storage.getTradesSince(freshUser.id, todayStart);
      const currentHoldings = await storage.getPortfolio(freshUser.id);

      const currentCash = freshUser.balance;
      const holdingsMap: Record<string, number> = {};
      for (const h of currentHoldings) {
        if (h.quantity > 0) holdingsMap[h.symbol] = h.quantity;
      }

      let startOfDayCash = currentCash;
      const startOfDayHoldings: Record<string, number> = { ...holdingsMap };

      for (const trade of todayTrades) {
        if (trade.type === "buy") {
          startOfDayCash += trade.total;
          startOfDayHoldings[trade.symbol] = (startOfDayHoldings[trade.symbol] || 0) - trade.quantity;
          if (startOfDayHoldings[trade.symbol] !== undefined && Math.abs(startOfDayHoldings[trade.symbol]) < 1e-10) {
            delete startOfDayHoldings[trade.symbol];
          }
        } else {
          startOfDayCash -= trade.total;
          startOfDayHoldings[trade.symbol] = (startOfDayHoldings[trade.symbol] || 0) + trade.quantity;
        }
      }

      let currentTotalValue = currentCash;
      let startOfDayTotalValue = startOfDayCash;

      const allSymbols = new Set([...Object.keys(holdingsMap), ...Object.keys(startOfDayHoldings)]);
      const perSymbol: Record<string, number> = {};

      for (const sym of allSymbols) {
        const ticker = tickerMap.get(sym);
        const currentPrice = ticker ? parseFloat(ticker.lastPrice) : 0;
        const openPrice = ticker ? parseFloat(ticker.openPrice) : currentPrice;
        const currentQty = holdingsMap[sym] || 0;
        const startQty = startOfDayHoldings[sym] || 0;

        currentTotalValue += currentQty * currentPrice;
        startOfDayTotalValue += startQty * openPrice;

        perSymbol[sym] = (currentQty * currentPrice) - (startQty * openPrice);
        const cashDiff = todayTrades
          .filter(t => t.symbol === sym)
          .reduce((sum, t) => t.type === "sell" ? sum + t.total : sum - t.total, 0);
        perSymbol[sym] += cashDiff;
      }

      const totalPnl = currentTotalValue - startOfDayTotalValue;

      res.json({
        totalPnl,
        perSymbol,
        startOfDayValue: startOfDayTotalValue,
        currentValue: currentTotalValue,
        periodStart: todayStart.toISOString(),
      });
    } catch (e) {
      console.error("Today PNL error:", e);
      res.status(500).json({ message: "Failed to calculate PNL" });
    }
  });

  app.get("/api/portfolio/pnl-history", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const freshUser = await storage.getUser(req.user!.id);
      if (!freshUser) return res.sendStatus(401);

      const allTrades = await storage.getTrades(freshUser.id);
      if (allTrades.length === 0) {
        return res.json({ dailyPnl: [], cumulativePnl: 0, weeklyPnl: 0, startingBalance: 100000 });
      }

      allTrades.sort((a, b) => {
        const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return ta - tb;
      });

      const holdingsState: Record<string, { qty: number; avgCost: number }> = {};

      const dailyMap: Record<string, number> = {};

      function getTradingDayKey(ts: Date): string {
        const shifted = new Date(ts);
        if (shifted.getHours() < 6) {
          shifted.setDate(shifted.getDate() - 1);
        }
        return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}-${String(shifted.getDate()).padStart(2, "0")}`;
      }

      for (const trade of allTrades) {
        const ts = trade.timestamp ? new Date(trade.timestamp) : new Date();
        const dayKey = getTradingDayKey(ts);

        if (!dailyMap[dayKey]) dailyMap[dayKey] = 0;

        if (trade.type === "buy") {
          const existing = holdingsState[trade.symbol];
          if (existing) {
            const newQty = existing.qty + trade.quantity;
            const newAvg = ((existing.avgCost * existing.qty) + trade.total) / newQty;
            holdingsState[trade.symbol] = { qty: newQty, avgCost: newAvg };
          } else {
            holdingsState[trade.symbol] = { qty: trade.quantity, avgCost: trade.price };
          }
        } else {
          const existing = holdingsState[trade.symbol];
          if (existing) {
            const realizedPnl = (trade.price - existing.avgCost) * trade.quantity;
            dailyMap[dayKey] += realizedPnl;
            const newQty = existing.qty - trade.quantity;
            if (newQty <= 0.00000001) {
              delete holdingsState[trade.symbol];
            } else {
              holdingsState[trade.symbol] = { qty: newQty, avgCost: existing.avgCost };
            }
          }
        }
      }

      const sortedDays = Object.keys(dailyMap).sort();
      let cumulative = 0;
      const dailyPnl = sortedDays.map((day) => {
        cumulative += dailyMap[day];
        return { date: day, pnl: dailyMap[day], cumulative };
      });

      const now = new Date();
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const sevenDayKey = `${sevenDaysAgo.getFullYear()}-${String(sevenDaysAgo.getMonth() + 1).padStart(2, "0")}-${String(sevenDaysAgo.getDate()).padStart(2, "0")}`;

      const weeklyPnl = dailyPnl
        .filter((d) => d.date >= sevenDayKey)
        .reduce((sum, d) => sum + d.pnl, 0);

      res.json({
        dailyPnl,
        cumulativePnl: cumulative,
        weeklyPnl,
        startingBalance: 100000,
      });
    } catch (e) {
      console.error("PNL history error:", e);
      res.status(500).json({ message: "Failed to calculate PNL history" });
    }
  });

  app.get("/api/watchlist", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const items = await storage.getWatchlist(req.user!.id);
    res.json(items);
  });

  app.post("/api/watchlist", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const { symbol } = req.body;
    if (!symbol) return res.status(400).json({ message: "Symbol required" });
    const item = await storage.addToWatchlist(req.user!.id, symbol);
    res.json(item);
  });

  app.delete("/api/watchlist/:symbol", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    await storage.removeFromWatchlist(req.user!.id, req.params.symbol);
    res.json({ success: true });
  });

  app.post("/api/user/telegram", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const schema = z.object({
        telegramBotToken: z.string().min(1),
        telegramChatId: z.string().min(1),
      });
      const data = schema.parse(req.body);
      const token = data.telegramBotToken.trim();
      const chatId = data.telegramChatId.trim();
      
      if (!token.includes(":")) {
        return res.status(400).json({ message: "Invalid bot token format. It should look like: 1234567890:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw" });
      }

      await storage.updateUserTelegram(req.user!.id, token, chatId);
      const updatedUser = await storage.getUser(req.user!.id);
      res.json(updatedUser);
    } catch (e) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ message: e.errors[0].message });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/user/telegram/test", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = await storage.getUser(req.user!.id);
    if (!user?.telegramBotToken || !user?.telegramChatId) {
      return res.status(400).json({ message: "Telegram settings not configured" });
    }
    const botToken = user.telegramBotToken.trim();
    const chatId = user.telegramChatId.trim();
    
    if (!botToken.includes(":")) {
      return res.status(400).json({ message: "Invalid bot token format. It should look like: 1234567890:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw" });
    }

    const result = await sendTelegramMessage(
      botToken,
      chatId,
      `<b>Test Message</b>\n\nYour Telegram alerts are working! You'll receive price alert notifications here.\n\n- Self Treding`
    );
    if (result.ok) {
      res.json({ success: true });
    } else {
      res.status(400).json({ message: result.error || "Failed to send test message. Check your bot token and chat ID." });
    }
  });

  app.get("/api/alerts", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const alerts = await storage.getPriceAlerts(req.user!.id);
    res.json(alerts);
  });

  app.post("/api/alerts", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const schema = z.object({
        symbol: z.string().min(1),
        targetPrice: z.coerce.number(),
        direction: z.enum(["above", "below"]),
        notifyTelegram: z.boolean().optional().default(true),
        alertType: z.enum(["price", "indicator"]).optional().default("price"),
        indicator: z.string().optional(),
        indicatorCondition: z.string().optional(),
        chartInterval: z.string().optional(),
      });
      const data = schema.parse(req.body);
      if (data.alertType === "indicator") {
        if (!data.indicator || !data.indicatorCondition || !data.chartInterval) {
          return res.status(400).json({ message: "Indicator alerts require indicator, indicatorCondition, and chartInterval" });
        }
      }
      const alert = await storage.createPriceAlert((req.user as any).id, data);
      res.status(201).json(alert);
    } catch (e) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ message: e.errors[0].message });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/alerts/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const alertId = parseInt(req.params.id);
    if (isNaN(alertId)) return res.status(400).json({ message: "Invalid alert ID" });
    await storage.deletePriceAlert(req.user!.id, alertId);
    res.json({ success: true });
  });

  app.get("/api/alerts/triggered", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const alerts = await storage.getPriceAlerts(req.user!.id);
    const triggered = alerts.filter(a => a.triggered);
    res.json(triggered);
  });

  let fngCache: { data: any; timestamp: number } | null = null;
  const FNG_CACHE_TTL = 5 * 60 * 1000;

  let newsCache: { data: any; timestamp: number } | null = null;
  const NEWS_CACHE_TTL = 3 * 60 * 1000;

  app.get("/api/market/fear-greed", async (_req, res) => {
    try {
      if (fngCache && Date.now() - fngCache.timestamp < FNG_CACHE_TTL) {
        return res.json(fngCache.data);
      }
      const response = await fetch("https://api.alternative.me/fng/?limit=30&date_format=world");
      if (!response.ok) throw new Error("Failed to fetch Fear & Greed data");
      const json = await response.json();
      fngCache = { data: json, timestamp: Date.now() };
      res.json(json);
    } catch (e) {
      console.error("[FNG] Error fetching Fear & Greed Index:", e);
      if (fngCache) return res.json(fngCache.data);
      res.status(500).json({ message: "Failed to fetch Fear & Greed Index" });
    }
  });

  app.get("/api/market/news", async (_req, res) => {
    try {
      if (newsCache && Date.now() - newsCache.timestamp < NEWS_CACHE_TTL) {
        return res.json(newsCache.data);
      }
      const response = await fetch(
        "https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=popular"
      );
      if (!response.ok) throw new Error("Failed to fetch crypto news");
      const json = await response.json();
      const articles = (json.Data || []).slice(0, 50).map((item: any) => ({
        id: item.id,
        title: item.title,
        body: item.body?.substring(0, 300) || "",
        url: item.url,
        imageUrl: item.imageurl,
        source: item.source_info?.name || item.source || "Unknown",
        publishedAt: item.published_on,
        categories: item.categories || "",
      }));
      newsCache = { data: articles, timestamp: Date.now() };
      res.json(articles);
    } catch (e) {
      console.error("[News] Error fetching crypto news:", e);
      if (newsCache) return res.json(newsCache.data);
      res.status(500).json({ message: "Failed to fetch news" });
    }
  });

  app.get("/api/admin/users", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = req.user as any;
    if (!user.isAdmin) return res.status(403).json({ message: "Admin access required" });
    const allUsers = await storage.getAllUsers();
    const safeUsers = allUsers.map(u => ({
      id: u.id,
      username: u.username,
      email: u.email,
      isAdmin: u.isAdmin,
      balance: u.balance,
    }));
    res.json(safeUsers);
  });

  app.post("/api/admin/topup", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = req.user as any;
    if (!user.isAdmin) return res.status(403).json({ message: "Admin access required" });
    try {
      const schema = z.object({
        userId: z.coerce.number().int().positive(),
        amount: z.coerce.number().positive(),
      });
      const { userId, amount } = schema.parse(req.body);
      const targetUser = await storage.getUser(userId);
      if (!targetUser) return res.status(404).json({ message: "User not found" });
      const newBalance = targetUser.balance + amount;
      await storage.updateUserBalance(userId, newBalance);
      res.json({ success: true, newBalance, username: targetUser.username });
    } catch (e) {
      if (e instanceof z.ZodError) {
        return res.status(400).json({ message: e.errors[0].message });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  return httpServer;
}
