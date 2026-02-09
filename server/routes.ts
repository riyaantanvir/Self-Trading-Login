import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { setupAuth, hashPassword } from "./auth";
import { z } from "zod";
import { WebSocketServer, WebSocket } from "ws";

const TRACKED_SYMBOLS = [
  "btcusdt", "ethusdt", "bnbusdt", "xrpusdt", "solusdt",
  "adausdt", "dogeusdt", "dotusdt", "trxusdt", "linkusdt",
  "avaxusdt", "uniusdt", "ltcusdt", "atomusdt", "etcusdt",
  "xlmusdt", "nearusdt", "algousdt", "filusdt", "polusdt",
];

interface TickerData {
  symbol: string;
  lastPrice: string;
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

  return httpServer;
}
