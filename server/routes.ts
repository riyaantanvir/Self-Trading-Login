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

  let lastSeenNewsIds = new Set<string>();
  let newsAlertInitialized = false;

  setInterval(async () => {
    try {
      const response = await fetch(
        "https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=latest"
      );
      if (!response.ok) return;
      const json = await response.json();
      const articles = (json.Data || []).slice(0, 20);

      if (!newsAlertInitialized) {
        for (const a of articles) lastSeenNewsIds.add(String(a.id));
        newsAlertInitialized = true;
        console.log(`[News Alerts] Initialized with ${lastSeenNewsIds.size} existing articles`);
        return;
      }

      const newArticles = articles.filter((a: any) => !lastSeenNewsIds.has(String(a.id)));
      if (newArticles.length === 0) return;

      for (const a of articles) lastSeenNewsIds.add(String(a.id));
      if (lastSeenNewsIds.size > 200) {
        const arr = Array.from(lastSeenNewsIds);
        lastSeenNewsIds = new Set(arr.slice(arr.length - 100));
      }

      const usersWithAlerts = await storage.getUsersWithNewsAlerts();
      if (usersWithAlerts.length === 0) return;

      for (const article of newArticles) {
        const title = article.title || "Untitled";
        const source = article.source_info?.name || article.source || "Unknown";
        const url = article.url || "";
        const msg = `<b>Crypto News Alert</b>\n\n<b>${title}</b>\n<i>Source: ${source}</i>\n\n<a href="${url}">Read full article</a>\n\n- Self Treding`;

        for (const user of usersWithAlerts) {
          if (user.telegramBotToken && user.telegramChatId) {
            try {
              await sendTelegramMessage(user.telegramBotToken, user.telegramChatId, msg);
            } catch (err) {
              console.error(`[News Alerts] Failed to send to user ${user.id}:`, err);
            }
          }
        }
      }

      console.log(`[News Alerts] Sent ${newArticles.length} new article(s) to ${usersWithAlerts.length} user(s)`);
    } catch (err) {
      console.error("[News Alerts] Error:", err);
    }
  }, 2 * 60 * 1000);

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

  const trendCache: { data: any; timestamp: number } = { data: null, timestamp: 0 };
  app.get("/api/market/trends", async (_req, res) => {
    try {
      const now = Date.now();
      if (trendCache.data && now - trendCache.timestamp < 60000) {
        return res.json(trendCache.data);
      }

      const symbols = TRACKED_SYMBOLS.map(s => s.toUpperCase());
      const results: any[] = [];

      const batchSize = 5;
      for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        const promises = batch.map(async (sym) => {
          try {
            const url = `https://data-api.binance.vision/api/v3/klines?symbol=${sym}&interval=1h&limit=50`;
            const response = await fetch(url);
            if (!response.ok) return null;
            const data = await response.json();
            const closes = (data as any[]).map((k: any) => parseFloat(k[4]));
            const volumes = (data as any[]).map((k: any) => parseFloat(k[5]));

            if (closes.length < 26) return null;

            const ema9 = computeEMA(closes, 9);
            const ema21 = computeEMA(closes, 21);
            const ema50 = computeEMA(closes, 50);
            const currentPrice = closes[closes.length - 1];
            const avgVol = volumes.slice(0, -1).reduce((a: number, b: number) => a + b, 0) / (volumes.length - 1);
            const currentVol = volumes[volumes.length - 1];
            const volRatio = avgVol > 0 ? currentVol / avgVol : 1;

            let trend: "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell" = "neutral";
            let score = 0;
            if (ema9 > ema21) score++;
            if (ema21 > ema50) score++;
            if (currentPrice > ema9) score++;
            if (currentPrice > ema21) score++;
            if (ema9 < ema21) score--;
            if (ema21 < ema50) score--;
            if (currentPrice < ema9) score--;
            if (currentPrice < ema21) score--;

            if (score >= 3) trend = "strong_buy";
            else if (score >= 1) trend = "buy";
            else if (score <= -3) trend = "strong_sell";
            else if (score <= -1) trend = "sell";

            return {
              symbol: sym,
              trend,
              score,
              ema9: +ema9.toFixed(8),
              ema21: +ema21.toFixed(8),
              ema50: +ema50.toFixed(8),
              price: currentPrice,
              volRatio: +volRatio.toFixed(2),
              volumeAnomaly: volRatio > 2,
            };
          } catch {
            return null;
          }
        });
        const batchResults = await Promise.all(promises);
        results.push(...batchResults.filter(Boolean));
      }

      trendCache.data = results;
      trendCache.timestamp = now;
      res.json(results);
    } catch (err) {
      console.error("Trends error:", err);
      res.status(500).json({ message: "Failed to compute trends" });
    }
  });

  const depthCache: { [key: string]: { data: any; timestamp: number } } = {};
  async function handleOrderbookDepth(req: any, res: any) {
    try {
      const symbol = ((req.params.symbol || req.query.symbol as string) || "BTCUSDT").toUpperCase();
      const now = Date.now();
      if (depthCache[symbol] && now - depthCache[symbol].timestamp < 10000) {
        return res.json(depthCache[symbol].data);
      }

      const url = `https://data-api.binance.vision/api/v3/depth?symbol=${symbol}&limit=100`;
      const response = await fetch(url);
      if (!response.ok) throw new Error("Binance depth API failed");
      const raw = await response.json() as { bids: string[][]; asks: string[][] };

      const currentTicker = tickerMap.get(symbol);
      const currentPrice = currentTicker ? parseFloat(currentTicker.lastPrice) : 0;

      const aggregateLevels = (levels: string[][], side: "bid" | "ask") => {
        const grouped: { price: number; quantity: number; total: number }[] = [];
        let cumulative = 0;
        for (const [priceStr, qtyStr] of levels) {
          const price = parseFloat(priceStr);
          const qty = parseFloat(qtyStr);
          const usdValue = price * qty;
          cumulative += usdValue;
          grouped.push({ price, quantity: qty, total: cumulative });
        }
        return grouped;
      };

      const bids = aggregateLevels(raw.bids, "bid");
      const asks = aggregateLevels(raw.asks, "ask");

      const bidWalls = bids
        .filter(b => b.quantity * b.price > 50000)
        .sort((a, b) => (b.quantity * b.price) - (a.quantity * a.price))
        .slice(0, 5);
      const askWalls = asks
        .filter(a => a.quantity * a.price > 50000)
        .sort((a, b) => (b.quantity * b.price) - (a.quantity * a.price))
        .slice(0, 5);

      const result = {
        symbol,
        currentPrice,
        bids: bids.slice(0, 20),
        asks: asks.slice(0, 20),
        bidWalls,
        askWalls,
        totalBidDepth: bids.reduce((s, b) => s + b.quantity * b.price, 0),
        totalAskDepth: asks.reduce((s, a) => s + a.quantity * a.price, 0),
      };

      depthCache[symbol] = { data: result, timestamp: now };
      res.json(result);
    } catch (err) {
      console.error("Depth error:", err);
      res.status(500).json({ message: "Failed to fetch order book depth" });
    }
  }
  app.get("/api/market/orderbook-depth/:symbol", handleOrderbookDepth);
  app.get("/api/market/orderbook-depth", handleOrderbookDepth);

  const longShortCache: { data: any; timestamp: number } = { data: null, timestamp: 0 };
  app.get("/api/market/long-short", async (_req, res) => {
    try {
      const now = Date.now();
      if (longShortCache.data && now - longShortCache.timestamp < 30000) {
        return res.json(longShortCache.data);
      }

      const topSymbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT"];
      const results: any[] = [];

      const promises = topSymbols.map(async (sym) => {
        try {
          const depthUrl = `https://data-api.binance.vision/api/v3/depth?symbol=${sym}&limit=50`;
          const depthRes = await fetch(depthUrl);
          if (!depthRes.ok) return null;
          const depth = await depthRes.json() as { bids: string[][]; asks: string[][] };

          const bidVolume = depth.bids.reduce((sum: number, [p, q]: string[]) => sum + parseFloat(p) * parseFloat(q), 0);
          const askVolume = depth.asks.reduce((sum: number, [p, q]: string[]) => sum + parseFloat(p) * parseFloat(q), 0);
          const total = bidVolume + askVolume;

          const ticker = tickerMap.get(sym);
          const priceChange = ticker ? parseFloat(ticker.priceChangePercent) : 0;

          const bidPressure = total > 0 ? bidVolume / total : 0.5;
          const trendBias = priceChange > 0 ? 0.02 : priceChange < 0 ? -0.02 : 0;

          const longAccount = Math.min(0.85, Math.max(0.15, bidPressure + trendBias));
          const shortAccount = 1 - longAccount;

          return {
            symbol: sym,
            longAccount: +longAccount.toFixed(4),
            shortAccount: +shortAccount.toFixed(4),
            longShortRatio: +(longAccount / shortAccount).toFixed(4),
            bidVolume: +bidVolume.toFixed(2),
            askVolume: +askVolume.toFixed(2),
          };
        } catch {
          return null;
        }
      });

      const batchResults = await Promise.all(promises);
      results.push(...batchResults.filter(Boolean));

      const avgLong = results.length > 0 ? results.reduce((s: number, r: any) => s + r.longAccount, 0) / results.length : 0.5;
      const avgShort = results.length > 0 ? results.reduce((s: number, r: any) => s + r.shortAccount, 0) / results.length : 0.5;

      const response = {
        coins: results,
        marketSentiment: {
          avgLong: +avgLong.toFixed(4),
          avgShort: +avgShort.toFixed(4),
          overallRatio: avgShort > 0 ? +(avgLong / avgShort).toFixed(4) : 1,
          bias: avgLong > avgShort ? "long" as const : avgShort > avgLong ? "short" as const : "neutral" as const,
        },
      };

      longShortCache.data = response;
      longShortCache.timestamp = now;
      res.json(response);
    } catch (err) {
      console.error("Long/Short error:", err);
      res.status(500).json({ message: "Failed to fetch long/short data" });
    }
  });

  // --- Trade Signals endpoints ---

  const scannerCache: { data: any; timestamp: number } = { data: null, timestamp: 0 };
  app.get("/api/market/scanner", async (_req, res) => {
    try {
      const now = Date.now();
      if (scannerCache.data && now - scannerCache.timestamp < 30000) {
        return res.json(scannerCache.data);
      }

      const symbols = TRACKED_SYMBOLS.map(s => s.toUpperCase());
      const results: any[] = [];
      const batchSize = 5;

      for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        const promises = batch.map(async (sym) => {
          try {
            const url = `https://data-api.binance.vision/api/v3/klines?symbol=${sym}&interval=1h&limit=50`;
            const response = await fetch(url);
            if (!response.ok) return null;
            const data = await response.json();
            const closes = (data as any[]).map((k: any) => parseFloat(k[4]));
            const volumes = (data as any[]).map((k: any) => parseFloat(k[5]));
            const highs = (data as any[]).map((k: any) => parseFloat(k[2]));
            const lows = (data as any[]).map((k: any) => parseFloat(k[3]));

            const currentPrice = closes[closes.length - 1];
            const rsi = computeRSI(closes, 14);
            const ema9 = computeEMAArray(closes, 9);
            const ema21 = computeEMAArray(closes, 21);
            const ema50 = computeEMAArray(closes, 50);

            const macdLine = ema9[ema9.length - 1] - ema21[ema21.length - 1];
            const prevMacdLine = ema9[ema9.length - 2] - ema21[ema21.length - 2];

            const avgVol = volumes.slice(0, -1).reduce((a: number, b: number) => a + b, 0) / (volumes.length - 1);
            const currentVol = volumes[volumes.length - 1];
            const volRatio = avgVol > 0 ? currentVol / avgVol : 1;

            const volatility = highs.slice(-14).reduce((sum: number, h: number, idx: number) => {
              return sum + ((h - lows.slice(-14)[idx]) / lows.slice(-14)[idx]) * 100;
            }, 0) / 14;

            const ticker = tickerMap.get(sym);
            const priceChange24h = ticker ? parseFloat(ticker.priceChangePercent) : 0;
            const volume24h = ticker ? parseFloat(ticker.quoteVolume) : 0;

            let signal: "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell" = "neutral";
            let signalScore = 0;
            if (rsi < 30) signalScore += 2;
            else if (rsi < 40) signalScore += 1;
            else if (rsi > 70) signalScore -= 2;
            else if (rsi > 60) signalScore -= 1;
            if (ema9[ema9.length - 1] > ema21[ema21.length - 1]) signalScore += 1;
            else signalScore -= 1;
            if (currentPrice > ema50[ema50.length - 1]) signalScore += 1;
            else signalScore -= 1;
            if (macdLine > 0 && prevMacdLine <= 0) signalScore += 1;
            if (macdLine < 0 && prevMacdLine >= 0) signalScore -= 1;
            if (volRatio > 2) signalScore += (macdLine > 0 ? 1 : -1);

            if (signalScore >= 3) signal = "strong_buy";
            else if (signalScore >= 1) signal = "buy";
            else if (signalScore <= -3) signal = "strong_sell";
            else if (signalScore <= -1) signal = "sell";

            return {
              symbol: sym,
              price: currentPrice,
              priceChange24h,
              volume24h,
              rsi: +rsi.toFixed(2),
              ema9: +ema9[ema9.length - 1].toFixed(6),
              ema21: +ema21[ema21.length - 1].toFixed(6),
              ema50: +ema50[ema50.length - 1].toFixed(6),
              macdLine: +macdLine.toFixed(6),
              volRatio: +volRatio.toFixed(2),
              volatility: +volatility.toFixed(2),
              signal,
              signalScore,
              flags: {
                oversold: rsi < 30,
                overbought: rsi > 70,
                volumeSpike: volRatio > 2,
                emaCrossUp: ema9[ema9.length - 1] > ema21[ema21.length - 1] && ema9[ema9.length - 2] <= ema21[ema21.length - 2],
                emaCrossDown: ema9[ema9.length - 1] < ema21[ema21.length - 1] && ema9[ema9.length - 2] >= ema21[ema21.length - 2],
              },
            };
          } catch { return null; }
        });
        const batchResults = await Promise.all(promises);
        results.push(...batchResults.filter(Boolean));
      }

      scannerCache.data = results;
      scannerCache.timestamp = now;
      res.json(results);
    } catch (err) {
      console.error("Scanner error:", err);
      res.status(500).json({ message: "Failed to run scanner" });
    }
  });

  app.get("/api/market/support-resistance/:symbol", async (req, res) => {
    try {
      const symbol = req.params.symbol.toUpperCase();
      const url = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1h&limit=200`;
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch klines");
      const data = await response.json();
      const candles = (data as any[]).map((k: any) => ({
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }));

      const currentPrice = candles[candles.length - 1].close;
      const levels: { price: number; strength: number; type: "support" | "resistance"; touches: number }[] = [];
      const tolerance = currentPrice * 0.005;

      for (let i = 2; i < candles.length - 2; i++) {
        const c = candles[i];
        const isSwingHigh = c.high > candles[i - 1].high && c.high > candles[i - 2].high &&
                            c.high > candles[i + 1].high && c.high > candles[i + 2].high;
        const isSwingLow = c.low < candles[i - 1].low && c.low < candles[i - 2].low &&
                           c.low < candles[i + 1].low && c.low < candles[i + 2].low;

        if (isSwingHigh) {
          const existing = levels.find(l => Math.abs(l.price - c.high) < tolerance);
          if (existing) { existing.touches++; existing.strength += c.volume; }
          else levels.push({ price: +c.high.toFixed(8), strength: c.volume, type: c.high > currentPrice ? "resistance" : "support", touches: 1 });
        }
        if (isSwingLow) {
          const existing = levels.find(l => Math.abs(l.price - c.low) < tolerance);
          if (existing) { existing.touches++; existing.strength += c.volume; }
          else levels.push({ price: +c.low.toFixed(8), strength: c.volume, type: c.low > currentPrice ? "resistance" : "support", touches: 1 });
        }
      }

      levels.sort((a, b) => b.touches * b.strength - a.touches * a.strength);
      const supports = levels.filter(l => l.type === "support").slice(0, 5);
      const resistances = levels.filter(l => l.type === "resistance").slice(0, 5);
      const maxStrength = Math.max(...levels.map(l => l.touches * l.strength), 1);

      res.json({
        symbol,
        currentPrice,
        supports: supports.map(l => ({ ...l, strengthPct: +((l.touches * l.strength / maxStrength) * 100).toFixed(1) })),
        resistances: resistances.map(l => ({ ...l, strengthPct: +((l.touches * l.strength / maxStrength) * 100).toFixed(1) })),
      });
    } catch (err) {
      console.error("S/R error:", err);
      res.status(500).json({ message: "Failed to compute support/resistance" });
    }
  });

  const correlationCache: { data: any; timestamp: number } = { data: null, timestamp: 0 };
  app.get("/api/market/correlation", async (_req, res) => {
    try {
      const now = Date.now();
      if (correlationCache.data && now - correlationCache.timestamp < 120000) {
        return res.json(correlationCache.data);
      }

      const topSymbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "DOTUSDT"];
      const priceData: { [sym: string]: number[] } = {};

      const batchSize = 5;
      for (let i = 0; i < topSymbols.length; i += batchSize) {
        const batch = topSymbols.slice(i, i + batchSize);
        const promises = batch.map(async (sym) => {
          const url = `https://data-api.binance.vision/api/v3/klines?symbol=${sym}&interval=1h&limit=72`;
          const response = await fetch(url);
          if (!response.ok) return null;
          const data = await response.json();
          const closes = (data as any[]).map((k: any) => parseFloat(k[4]));
          const returns: number[] = [];
          for (let j = 1; j < closes.length; j++) {
            returns.push((closes[j] - closes[j - 1]) / closes[j - 1]);
          }
          return { sym, returns };
        });
        const batchResults = await Promise.all(promises);
        batchResults.forEach(r => { if (r) priceData[r.sym] = r.returns; });
      }

      const symbols = Object.keys(priceData);
      const matrix: { sym1: string; sym2: string; correlation: number }[] = [];

      for (let i = 0; i < symbols.length; i++) {
        for (let j = i; j < symbols.length; j++) {
          const r1 = priceData[symbols[i]];
          const r2 = priceData[symbols[j]];
          const len = Math.min(r1.length, r2.length);
          const mean1 = r1.slice(0, len).reduce((a, b) => a + b, 0) / len;
          const mean2 = r2.slice(0, len).reduce((a, b) => a + b, 0) / len;
          let cov = 0, var1 = 0, var2 = 0;
          for (let k = 0; k < len; k++) {
            const d1 = r1[k] - mean1;
            const d2 = r2[k] - mean2;
            cov += d1 * d2;
            var1 += d1 * d1;
            var2 += d2 * d2;
          }
          const corr = (var1 > 0 && var2 > 0) ? cov / Math.sqrt(var1 * var2) : (i === j ? 1 : 0);
          matrix.push({ sym1: symbols[i], sym2: symbols[j], correlation: +corr.toFixed(4) });
        }
      }

      const result = { symbols, matrix };
      correlationCache.data = result;
      correlationCache.timestamp = now;
      res.json(result);
    } catch (err) {
      console.error("Correlation error:", err);
      res.status(500).json({ message: "Failed to compute correlations" });
    }
  });

  const whaleCache: { data: any; timestamp: number } = { data: null, timestamp: 0 };
  app.get("/api/market/whale-watch", async (_req, res) => {
    try {
      const now = Date.now();
      if (whaleCache.data && now - whaleCache.timestamp < 15000) {
        return res.json(whaleCache.data);
      }

      const topSymbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT"];
      const results: any[] = [];

      const promises = topSymbols.map(async (sym) => {
        try {
          const url = `https://data-api.binance.vision/api/v3/depth?symbol=${sym}&limit=100`;
          const response = await fetch(url);
          if (!response.ok) return null;
          const raw = await response.json() as { bids: string[][]; asks: string[][] };

          const bids = raw.bids.map(([p, q]: string[]) => ({ price: parseFloat(p), quantity: parseFloat(q) }));
          const asks = raw.asks.map(([p, q]: string[]) => ({ price: parseFloat(p), quantity: parseFloat(q) }));

          const totalBid = bids.reduce((s: number, b: any) => s + b.price * b.quantity, 0);
          const totalAsk = asks.reduce((s: number, a: any) => s + a.price * a.quantity, 0);

          const sortedBids = [...bids].sort((a: any, b: any) => b.quantity - a.quantity);
          const sortedAsks = [...asks].sort((a: any, b: any) => b.quantity - a.quantity);

          return {
            symbol: sym,
            totalBidDepth: totalBid,
            totalAskDepth: totalAsk,
            ratio: totalAsk > 0 ? totalBid / totalAsk : 1,
            biggestBidWall: sortedBids[0] || null,
            biggestAskWall: sortedAsks[0] || null,
          };
        } catch { return null; }
      });

      const batchResults = await Promise.all(promises);
      batchResults.forEach(r => { if (r) results.push(r); });

      whaleCache.data = results;
      whaleCache.timestamp = now;
      res.json(results);
    } catch (err) {
      console.error("Whale watch error:", err);
      res.status(500).json({ message: "Failed to fetch whale data" });
    }
  });

  function computeRSI(closes: number[], period: number): number {
    if (closes.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return +(100 - 100 / (1 + rs)).toFixed(2);
  }

  function computeEMAArray(data: number[], period: number): number[] {
    if (data.length === 0) return [];
    const k = 2 / (period + 1);
    const result = [data[0]];
    for (let i = 1; i < data.length; i++) {
      result.push(data[i] * k + result[i - 1] * (1 - k));
    }
    return result;
  }

  function computeEMA(data: number[], period: number): number {
    if (data.length === 0) return 0;
    const k = 2 / (period + 1);
    let ema = data[0];
    for (let i = 1; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    return ema;
  }

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

  app.get("/api/user/news-alerts", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = await storage.getUser(req.user!.id);
    res.json({ enabled: user?.newsAlertsEnabled || false });
  });

  app.post("/api/user/news-alerts", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = await storage.getUser(req.user!.id);
    if (!user?.telegramBotToken || !user?.telegramChatId) {
      return res.status(400).json({ message: "Please configure Telegram settings first before enabling news alerts" });
    }
    const schema = z.object({ enabled: z.boolean() });
    const { enabled } = schema.parse(req.body);
    await storage.updateNewsAlerts(req.user!.id, enabled);
    res.json({ success: true, enabled });
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
