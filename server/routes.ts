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

  setInterval(async () => {
    if (tickerMap.size === 0) return;
    try {
      const activeAlerts = await storage.getActivePriceAlerts();
      for (const alert of activeAlerts) {
        const ticker = tickerMap.get(alert.symbol);
        if (!ticker) continue;
        const currentPrice = parseFloat(ticker.lastPrice);
        const shouldTrigger =
          (alert.direction === "above" && currentPrice >= alert.targetPrice) ||
          (alert.direction === "below" && currentPrice <= alert.targetPrice);
        if (shouldTrigger) {
          await storage.triggerPriceAlert(alert.id);
          broadcast({
            type: "alert_triggered",
            data: {
              id: alert.id,
              userId: alert.userId,
              symbol: alert.symbol,
              targetPrice: alert.targetPrice,
              direction: alert.direction,
              currentPrice,
            },
          });

          if (alert.notifyTelegram) {
            try {
              const alertUser = await storage.getUser(alert.userId);
              if (alertUser?.telegramBotToken && alertUser?.telegramChatId) {
                const coin = alert.symbol.replace("USDT", "");
                const msg = `<b>Price Alert Triggered!</b>\n\n` +
                  `<b>${coin}/USDT</b> is now ${alert.direction === "above" ? "above" : "below"} your target.\n\n` +
                  `Target: $${Number(alert.targetPrice).toLocaleString()}\n` +
                  `Current: $${Number(currentPrice).toLocaleString()}\n\n` +
                  `- Self Treding`;
                await sendTelegramMessage(alertUser.telegramBotToken, alertUser.telegramChatId, msg);
              }
            } catch (tgErr) {
              console.error("[Telegram] Alert notification error:", tgErr);
            }
          }
        }
      }
    } catch (err) {
      console.error("[Alert Check] Error:", err);
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
      const schema = z.object({
        symbol: z.string(),
        type: z.enum(["buy", "sell"]),
        quantity: z.coerce.number().positive(),
        price: z.coerce.number().positive(),
      });
      const data = schema.parse(req.body);
      const total = data.quantity * data.price;
      const user = req.user!;

      if (total < 5) {
        return res.status(400).json({ message: "Minimum order amount is 5 USDT" });
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
        ...data,
        userId: user.id,
        total,
        status: "completed",
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
        targetPrice: z.coerce.number().positive(),
        direction: z.enum(["above", "below"]),
        notifyTelegram: z.boolean().optional().default(false),
      });
      const data = schema.parse(req.body);
      const alert = await storage.createPriceAlert(req.user!.id, data);
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

  return httpServer;
}
