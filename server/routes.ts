import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { setupAuth, hashPassword } from "./auth";
import { z } from "zod";
import { WebSocketServer, WebSocket } from "ws";
import { getKrakenUsdtBalance, getKrakenAllBalances, placeKrakenOrder, validateKrakenCredentials } from "./kraken-trade";

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

const DEFAULT_SYMBOLS = [
  "btcusdt", "ethusdt", "bnbusdt", "xrpusdt", "solusdt",
  "adausdt", "dogeusdt", "dotusdt", "trxusdt", "linkusdt",
  "avaxusdt", "uniusdt", "ltcusdt", "atomusdt", "etcusdt",
  "xlmusdt", "nearusdt", "algousdt", "filusdt", "polusdt",
];

let TRACKED_SYMBOLS: string[] = [...DEFAULT_SYMBOLS];
let reconnectBinanceWs: (() => void) | null = null;

async function loadTrackedSymbols(): Promise<string[]> {
  try {
    const coins = await storage.getTrackedCoins();
    if (coins.length > 0) {
      TRACKED_SYMBOLS = coins.map(c => c.symbol.toLowerCase());
    } else {
      TRACKED_SYMBOLS = [...DEFAULT_SYMBOLS];
    }
  } catch {
    TRACKED_SYMBOLS = [...DEFAULT_SYMBOLS];
  }
  return TRACKED_SYMBOLS;
}

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

async function fetchBinancePrice(symbol: string): Promise<number> {
  const upperSymbol = symbol.toUpperCase();
  const ticker = tickerMap.get(upperSymbol);
  if (ticker) return parseFloat(ticker.lastPrice);
  try {
    const res = await fetch(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${upperSymbol}`);
    if (res.ok) {
      const data = await res.json() as any;
      return parseFloat(data.price) || 0;
    }
  } catch (e) {
    console.error("[fetchBinancePrice] REST fallback error:", e);
  }
  return 0;
}

async function executeDcaSell(bot: any, step: number, quantity: number, price: number, avgBuyPrice: number) {
  const total = quantity * price;
  const user = await storage.getUser(bot.userId);
  if (!user) throw new Error("User not found");

  const portfolioItem = await storage.getPortfolioItem(bot.userId, bot.symbol);
  if (!portfolioItem || portfolioItem.quantity < quantity) {
    throw new Error(`Insufficient ${bot.symbol} quantity to sell`);
  }

  await storage.updateUserBalance(bot.userId, user.balance + total);
  const newQty = portfolioItem.quantity - quantity;
  if (newQty <= 0.00000001) {
    await storage.upsertPortfolioItem(bot.userId, bot.symbol, 0, 0);
  } else {
    await storage.upsertPortfolioItem(bot.userId, bot.symbol, newQty, portfolioItem.avgBuyPrice);
  }

  const pnl = quantity * (price - avgBuyPrice);

  await storage.createTrade({
    symbol: bot.symbol,
    type: "sell",
    quantity,
    price,
    status: "completed",
    orderType: "market",
    userId: bot.userId,
    total,
  } as any);

  await storage.createDcaBotOrder({
    botId: bot.id,
    userId: bot.userId,
    step,
    type: "sell",
    price,
    quantity,
    total,
  });

  await storage.incrementBotTrades(bot.id, pnl);
  return { success: true, pnl, soldQuantity: quantity };
}

async function setupBinanceLiveStream(httpServer: Server) {
  await loadTrackedSymbols();

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

  async function executeDcaBotCycle(bot: AutopilotBot) {
    const currentPrice = await fetchBinancePrice(bot.symbol);
    if (!currentPrice || currentPrice <= 0) return;

    let config: any = {};
    try { config = JSON.parse(bot.strategyConfig || "{}"); } catch { return; }
    if (config.strategy !== "dca_spot") return;

    const orders = await storage.getDcaBotOrders(bot.id);
    const executedBuys = orders.filter((o: any) => o.type === "buy");
    const executedSells = orders.filter((o: any) => o.type === "sell");

    const supportBroken = config.riskControl?.supportBreakStop && config.supportPrice > 0 && currentPrice < config.supportPrice;

    const totalCapital = config.totalCapital || bot.tradeAmount;
    const buySteps = config.buySteps || [];
    const sellSteps = config.sellSteps || [];
    const maxBuySteps = config.maxBuySteps || 5;

    if (!supportBroken && executedBuys.length < maxBuySteps) {
      const entryPrice = config.orderType === "limit" && config.limitPrice ? config.limitPrice : (executedBuys.length > 0 ? executedBuys[0].price : currentPrice);

      for (const step of buySteps) {
        if (executedBuys.find((o: any) => o.step === step.step)) continue;

        let triggerPrice: number;
        if (step.step === 1) {
          triggerPrice = entryPrice;
          if (config.orderType === "limit" && config.limitPrice && currentPrice > config.limitPrice) continue;
        } else {
          triggerPrice = entryPrice * (1 - step.dropPercent / 100);
          if (currentPrice > triggerPrice) continue;
        }

        const capitalForStep = totalCapital * (step.percent / 100);
        const quantity = capitalForStep / currentPrice;
        const total = quantity * currentPrice;

        const user = await storage.getUser(bot.userId);
        if (!user || user.balance < total) continue;

        await storage.updateUserBalance(bot.userId, user.balance - total);

        const existing = await storage.getPortfolioItem(bot.userId, bot.symbol);
        if (existing) {
          const newQty = existing.quantity + quantity;
          const newAvg = ((existing.avgBuyPrice * existing.quantity) + total) / newQty;
          await storage.upsertPortfolioItem(bot.userId, bot.symbol, newQty, newAvg);
        } else {
          await storage.upsertPortfolioItem(bot.userId, bot.symbol, quantity, currentPrice);
        }

        await storage.createTrade({
          symbol: bot.symbol, type: "buy", quantity, price: currentPrice,
          status: "completed", orderType: config.orderType || "market",
          userId: bot.userId, total,
        } as any);

        await storage.createDcaBotOrder({
          botId: bot.id, userId: bot.userId, step: step.step,
          type: "buy", price: currentPrice, quantity, total,
        });
        await storage.incrementBotTrades(bot.id, 0);
        console.log(`[DCA Bot ${bot.id}] Auto buy step ${step.step} at $${currentPrice} qty ${quantity.toFixed(6)}`);
        break;
      }
    }

    if (executedBuys.length > 0) {
      const totalCost = executedBuys.reduce((s: number, o: any) => s + o.total, 0);
      const totalBuyQty = executedBuys.reduce((s: number, o: any) => s + o.quantity, 0);
      const totalSoldQty = executedSells.reduce((s: number, o: any) => s + o.quantity, 0);
      const avgPrice = totalBuyQty > 0 ? totalCost / totalBuyQty : 0;
      const remainingQty = totalBuyQty - totalSoldQty;

      if (remainingQty > 0.00000001 && avgPrice > 0) {
        for (const step of sellSteps) {
          if (executedSells.find((o: any) => o.step === step.step)) continue;

          const triggerPrice = avgPrice * (1 + step.risePercent / 100);
          if (currentPrice < triggerPrice) continue;

          let sellQty: number;
          if (step.sellRemaining) {
            sellQty = remainingQty;
          } else {
            sellQty = totalBuyQty * (step.percent / 100);
            if (sellQty > remainingQty) sellQty = remainingQty;
          }
          if (sellQty <= 0.00000001) continue;

          const total = sellQty * currentPrice;
          const user = await storage.getUser(bot.userId);
          if (!user) continue;

          const portfolioItem = await storage.getPortfolioItem(bot.userId, bot.symbol);
          if (!portfolioItem || portfolioItem.quantity < sellQty) continue;

          await storage.updateUserBalance(bot.userId, user.balance + total);
          const newQty = portfolioItem.quantity - sellQty;
          if (newQty <= 0.00000001) {
            await storage.upsertPortfolioItem(bot.userId, bot.symbol, 0, 0);
          } else {
            await storage.upsertPortfolioItem(bot.userId, bot.symbol, newQty, portfolioItem.avgBuyPrice);
          }

          const pnl = sellQty * (currentPrice - avgPrice);

          await storage.createTrade({
            symbol: bot.symbol, type: "sell", quantity: sellQty, price: currentPrice,
            status: "completed", orderType: "market",
            userId: bot.userId, total,
          } as any);

          await storage.createDcaBotOrder({
            botId: bot.id, userId: bot.userId, step: step.step,
            type: "sell", price: currentPrice, quantity: sellQty, total,
          });
          await storage.incrementBotTrades(bot.id, pnl);
          console.log(`[DCA Bot ${bot.id}] Auto sell step ${step.step} at $${currentPrice} qty ${sellQty.toFixed(6)} pnl $${pnl.toFixed(2)}`);
          break;
        }
      }
    }
  }

  setInterval(async () => {
    try {
      const activeDcaBots = await storage.getActiveDcaBots();
      for (const bot of activeDcaBots) {
        await executeDcaBotCycle(bot);
      }
    } catch (err) {
      console.error("[DCA Bot Engine] Error:", err);
    }
  }, 10000);

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

  const signalCooldowns = new Map<string, number>();
  const SIGNAL_COOLDOWN_MS = 30 * 60 * 1000;

  async function computeSupportResistance(symbol: string): Promise<{ supports: { price: number; touches: number }[]; resistances: { price: number; touches: number }[]; currentPrice: number } | null> {
    try {
      const url = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=1h&limit=200`;
      const response = await fetch(url);
      if (!response.ok) return null;
      const data = await response.json();
      const candles = (data as any[]).map((k: any) => ({
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }));
      const currentPrice = candles[candles.length - 1].close;
      const tolerance = currentPrice * 0.005;
      const levels: { price: number; strength: number; type: "support" | "resistance"; touches: number }[] = [];
      for (let i = 2; i < candles.length - 2; i++) {
        const c = candles[i];
        const isSwingHigh = c.high > candles[i - 1].high && c.high > candles[i - 2].high && c.high > candles[i + 1].high && c.high > candles[i + 2].high;
        const isSwingLow = c.low < candles[i - 1].low && c.low < candles[i - 2].low && c.low < candles[i + 1].low && c.low < candles[i + 2].low;
        if (isSwingHigh) {
          const existing = levels.find(l => Math.abs(l.price - c.high) < tolerance);
          if (existing) { existing.touches++; existing.strength += c.volume; }
          else levels.push({ price: c.high, strength: c.volume, type: c.high > currentPrice ? "resistance" : "support", touches: 1 });
        }
        if (isSwingLow) {
          const existing = levels.find(l => Math.abs(l.price - c.low) < tolerance);
          if (existing) { existing.touches++; existing.strength += c.volume; }
          else levels.push({ price: c.low, strength: c.volume, type: c.low > currentPrice ? "resistance" : "support", touches: 1 });
        }
      }
      levels.sort((a, b) => b.touches * b.strength - a.touches * a.strength);
      return {
        supports: levels.filter(l => l.type === "support").slice(0, 5),
        resistances: levels.filter(l => l.type === "resistance").slice(0, 5),
        currentPrice,
      };
    } catch {
      return null;
    }
  }

  setInterval(async () => {
    try {
      if (tickerMap.size === 0) return;
      const usersWithSignals = await storage.getUsersWithSignalAlerts();
      if (usersWithSignals.length === 0) return;

      const now = Date.now();
      if (scannerCache.data && now - scannerCache.timestamp < 60000) {
      } else {
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
              let signalScore = 0;
              if (rsi < 30) signalScore += 2; else if (rsi < 40) signalScore += 1;
              else if (rsi > 70) signalScore -= 2; else if (rsi > 60) signalScore -= 1;
              if (ema9[ema9.length - 1] > ema21[ema21.length - 1]) signalScore += 1; else signalScore -= 1;
              if (currentPrice > ema50[ema50.length - 1]) signalScore += 1; else signalScore -= 1;
              if (macdLine > 0 && prevMacdLine <= 0) signalScore += 1;
              if (macdLine < 0 && prevMacdLine >= 0) signalScore -= 1;
              if (volRatio > 2) signalScore += (macdLine > 0 ? 1 : -1);
              let signal = "neutral";
              if (signalScore >= 3) signal = "strong_buy";
              else if (signalScore >= 1) signal = "buy";
              else if (signalScore <= -3) signal = "strong_sell";
              else if (signalScore <= -1) signal = "sell";
              return { symbol: sym, price: currentPrice, rsi, signal, signalScore, volRatio };
            } catch { return null; }
          });
          const batchResults = await Promise.all(promises);
          results.push(...batchResults.filter(Boolean));
        }
        scannerCache.data = results;
        scannerCache.timestamp = now;
      }

      const scannerResults = scannerCache.data || [];
      const buySignals = scannerResults.filter((r: any) => r.signal === "buy" || r.signal === "strong_buy");
      const sellSignals = scannerResults.filter((r: any) => r.signal === "strong_sell");

      const alertCandidates: { symbol: string; price: number; signal: string; rsi: number; nearestLevel: number; levelType: string; distancePct: number; signalScore: number }[] = [];

      for (const sig of buySignals) {
        const cooldownKey = `buy_${sig.symbol}`;
        if (signalCooldowns.has(cooldownKey) && now - signalCooldowns.get(cooldownKey)! < SIGNAL_COOLDOWN_MS) continue;
        const sr = await computeSupportResistance(sig.symbol);
        if (!sr || sr.supports.length === 0) continue;
        const nearestSupport = sr.supports.reduce((closest: any, s: any) => {
          const dist = Math.abs(sig.price - s.price) / sig.price;
          return dist < closest.dist ? { price: s.price, dist, touches: s.touches } : closest;
        }, { price: 0, dist: Infinity, touches: 0 });
        if (nearestSupport.dist <= 0.03) {
          alertCandidates.push({
            symbol: sig.symbol, price: sig.price, signal: sig.signal, rsi: sig.rsi,
            nearestLevel: nearestSupport.price, levelType: "support",
            distancePct: +(nearestSupport.dist * 100).toFixed(2), signalScore: sig.signalScore,
          });
          signalCooldowns.set(cooldownKey, now);
        }
      }

      for (const sig of sellSignals) {
        const cooldownKey = `sell_${sig.symbol}`;
        if (signalCooldowns.has(cooldownKey) && now - signalCooldowns.get(cooldownKey)! < SIGNAL_COOLDOWN_MS) continue;
        const sr = await computeSupportResistance(sig.symbol);
        if (!sr || sr.resistances.length === 0) continue;
        const nearestResistance = sr.resistances.reduce((closest: any, r: any) => {
          const dist = Math.abs(sig.price - r.price) / sig.price;
          return dist < closest.dist ? { price: r.price, dist, touches: r.touches } : closest;
        }, { price: 0, dist: Infinity, touches: 0 });
        if (nearestResistance.dist <= 0.03) {
          alertCandidates.push({
            symbol: sig.symbol, price: sig.price, signal: sig.signal, rsi: sig.rsi,
            nearestLevel: nearestResistance.price, levelType: "resistance",
            distancePct: +(nearestResistance.dist * 100).toFixed(2), signalScore: sig.signalScore,
          });
          signalCooldowns.set(cooldownKey, now);
        }
      }

      if (alertCandidates.length === 0) return;

      for (const user of usersWithSignals) {
        if (!user.telegramBotToken || !user.telegramChatId) continue;
        for (const candidate of alertCandidates) {
          const coin = candidate.symbol.replace("USDT", "");
          const isBuy = candidate.signal === "buy" || candidate.signal === "strong_buy";
          const signalLabel = candidate.signal.replace("_", " ").toUpperCase();
          const actionEmoji = isBuy ? "\u{1F7E2}" : "\u{1F534}";
          const zoneType = isBuy ? "Support Zone" : "Resistance Zone";
          const recommendation = isBuy
            ? `Consider buying near $${candidate.nearestLevel.toFixed(2)} support with a stop below`
            : `Consider taking profit or selling near $${candidate.nearestLevel.toFixed(2)} resistance`;

          const msg = `${actionEmoji} <b>Smart Signal: ${signalLabel}</b>\n\n` +
            `<b>${coin}</b> @ $${candidate.price.toFixed(2)}\n` +
            `RSI: ${candidate.rsi.toFixed(1)} | Score: ${candidate.signalScore}\n\n` +
            `<b>${zoneType}:</b> $${candidate.nearestLevel.toFixed(2)}\n` +
            `Distance: ${candidate.distancePct}% from level\n\n` +
            `<i>${recommendation}</i>\n\n` +
            `- Self Treding Smart Alerts`;

          try {
            await sendTelegramMessage(user.telegramBotToken, user.telegramChatId, msg);
          } catch (err) {
            console.error(`[Signal Alert] Failed to send to user ${user.id}:`, err);
          }
        }
      }

      if (alertCandidates.length > 0) {
        console.log(`[Signal Alerts] Sent ${alertCandidates.length} signal(s) to ${usersWithSignals.length} user(s)`);
      }
    } catch (err) {
      console.error("[Signal Alerts] Error:", err);
    }
  }, 60000);

  connectBinance();

  reconnectBinanceWs = async () => {
    await loadTrackedSymbols();
    connectBinance();
  };

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

  function computeRSIArray(closes: number[], period: number): number[] {
    const result: number[] = [];
    if (closes.length < period + 1) return closes.map(() => 50);
    for (let i = 0; i < closes.length; i++) {
      if (i < period) { result.push(50); continue; }
      let gains = 0, losses = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const diff = closes[j] - closes[j - 1];
        if (diff > 0) gains += diff;
        else losses -= diff;
      }
      const avgGain = gains / period;
      const avgLoss = losses / period;
      if (avgLoss === 0) { result.push(100); continue; }
      const rs = avgGain / avgLoss;
      result.push(+(100 - 100 / (1 + rs)).toFixed(2));
    }
    return result;
  }

  function computeMACD(closes: number[]): { macd: number[]; signal: number[]; histogram: number[] } {
    const ema12 = computeEMAArray(closes, 12);
    const ema26 = computeEMAArray(closes, 26);
    const macdLine = ema12.map((v, i) => v - ema26[i]);
    const signalLine = computeEMAArray(macdLine, 9);
    const histogram = macdLine.map((v, i) => v - signalLine[i]);
    return { macd: macdLine, signal: signalLine, histogram };
  }

  const divergenceCache: { data: any; timestamp: number } = { data: null, timestamp: 0 };
  app.get("/api/market/divergence", async (_req, res) => {
    try {
      const now = Date.now();
      if (divergenceCache.data && now - divergenceCache.timestamp < 30000) {
        return res.json(divergenceCache.data);
      }

      const symbols = TRACKED_SYMBOLS.map(s => s.toUpperCase());
      const results: any[] = [];
      const batchSize = 5;

      for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        const promises = batch.map(async (sym) => {
          try {
            const url = `https://data-api.binance.vision/api/v3/klines?symbol=${sym}&interval=1h&limit=100`;
            const response = await fetch(url);
            if (!response.ok) return null;
            const data = await response.json();
            const closes = (data as any[]).map((k: any) => parseFloat(k[4]));
            const highs = (data as any[]).map((k: any) => parseFloat(k[2]));
            const lows = (data as any[]).map((k: any) => parseFloat(k[3]));

            if (closes.length < 30) return null;

            const rsiArr = computeRSIArray(closes, 14);
            const macdData = computeMACD(closes);
            const currentPrice = closes[closes.length - 1];

            const ticker = tickerMap.get(sym);
            const priceChange24h = ticker ? parseFloat(ticker.priceChangePercent) : 0;

            const divergences: { type: string; indicator: string; description: string; strength: string; barsAgo: number }[] = [];

            const lookback = 30;
            const startIdx = Math.max(15, closes.length - lookback);

            for (let j = startIdx; j < closes.length - 2; j++) {
              if (lows[j] <= lows[j - 1] && lows[j] <= lows[j + 1]) {
                for (let k = j + 3; k < closes.length - 1; k++) {
                  if (lows[k] <= lows[k - 1] && lows[k] <= lows[k + 1]) {
                    if (lows[k] < lows[j] && rsiArr[k] > rsiArr[j]) {
                      divergences.push({
                        type: "bullish",
                        indicator: "RSI",
                        description: `Price made lower low but RSI made higher low`,
                        strength: Math.abs(rsiArr[k] - rsiArr[j]) > 5 ? "strong" : "weak",
                        barsAgo: closes.length - 1 - k,
                      });
                    }
                    if (lows[k] < lows[j] && macdData.histogram[k] > macdData.histogram[j]) {
                      divergences.push({
                        type: "bullish",
                        indicator: "MACD",
                        description: `Price made lower low but MACD histogram made higher low`,
                        strength: "moderate",
                        barsAgo: closes.length - 1 - k,
                      });
                    }
                    break;
                  }
                }
              }

              if (highs[j] >= highs[j - 1] && highs[j] >= highs[j + 1]) {
                for (let k = j + 3; k < closes.length - 1; k++) {
                  if (highs[k] >= highs[k - 1] && highs[k] >= highs[k + 1]) {
                    if (highs[k] > highs[j] && rsiArr[k] < rsiArr[j]) {
                      divergences.push({
                        type: "bearish",
                        indicator: "RSI",
                        description: `Price made higher high but RSI made lower high`,
                        strength: Math.abs(rsiArr[k] - rsiArr[j]) > 5 ? "strong" : "weak",
                        barsAgo: closes.length - 1 - k,
                      });
                    }
                    if (highs[k] > highs[j] && macdData.histogram[k] < macdData.histogram[j]) {
                      divergences.push({
                        type: "bearish",
                        indicator: "MACD",
                        description: `Price made higher high but MACD histogram made lower high`,
                        strength: "moderate",
                        barsAgo: closes.length - 1 - k,
                      });
                    }
                    break;
                  }
                }
              }
            }

            const recentDivergences = divergences
              .filter(d => d.barsAgo <= 10)
              .sort((a, b) => a.barsAgo - b.barsAgo)
              .slice(0, 3);

            return {
              symbol: sym,
              price: currentPrice,
              priceChange24h,
              rsi: rsiArr[rsiArr.length - 1],
              macdHistogram: +macdData.histogram[macdData.histogram.length - 1].toFixed(6),
              divergences: recentDivergences,
              hasBullish: recentDivergences.some(d => d.type === "bullish"),
              hasBearish: recentDivergences.some(d => d.type === "bearish"),
            };
          } catch { return null; }
        });
        const batchResults = await Promise.all(promises);
        results.push(...batchResults.filter(Boolean));
      }

      divergenceCache.data = results;
      divergenceCache.timestamp = now;
      res.json(results);
    } catch (err) {
      console.error("Divergence error:", err);
      res.status(500).json({ message: "Failed to detect divergences" });
    }
  });

  const mtfCache: { data: any; timestamp: number } = { data: null, timestamp: 0 };
  app.get("/api/market/multi-timeframe", async (_req, res) => {
    try {
      const now = Date.now();
      if (mtfCache.data && now - mtfCache.timestamp < 30000) {
        return res.json(mtfCache.data);
      }

      const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT"];
      const timeframes = [
        { interval: "5m", label: "5m", limit: 60 },
        { interval: "15m", label: "15m", limit: 60 },
        { interval: "1h", label: "1H", limit: 60 },
        { interval: "4h", label: "4H", limit: 60 },
        { interval: "1d", label: "1D", limit: 60 },
      ];

      const results: any[] = [];

      for (const sym of symbols) {
        const tfResults: any = {};
        for (const tf of timeframes) {
          try {
            const url = `https://data-api.binance.vision/api/v3/klines?symbol=${sym}&interval=${tf.interval}&limit=${tf.limit}`;
            const response = await fetch(url);
            if (!response.ok) { tfResults[tf.label] = null; continue; }
            const data = await response.json();
            const closes = (data as any[]).map((k: any) => parseFloat(k[4]));

            if (closes.length < 21) { tfResults[tf.label] = null; continue; }

            const rsi = computeRSI(closes, 14);
            const ema9 = computeEMAArray(closes, 9);
            const ema21 = computeEMAArray(closes, 21);
            const currentPrice = closes[closes.length - 1];
            const macdData = computeMACD(closes);

            let trend: "bullish" | "bearish" | "neutral" = "neutral";
            let score = 0;
            if (ema9[ema9.length - 1] > ema21[ema21.length - 1]) score++;
            else score--;
            if (currentPrice > ema9[ema9.length - 1]) score++;
            else score--;
            if (rsi > 50) score++;
            else if (rsi < 50) score--;
            if (macdData.histogram[macdData.histogram.length - 1] > 0) score++;
            else score--;

            if (score >= 2) trend = "bullish";
            else if (score <= -2) trend = "bearish";

            tfResults[tf.label] = {
              rsi: +rsi.toFixed(2),
              ema9: +ema9[ema9.length - 1].toFixed(8),
              ema21: +ema21[ema21.length - 1].toFixed(8),
              macd: +macdData.histogram[macdData.histogram.length - 1].toFixed(8),
              trend,
              score,
              price: currentPrice,
            };
          } catch { tfResults[tf.label] = null; }
        }

        const trends = Object.values(tfResults).filter(Boolean).map((t: any) => t.trend);
        const allBullish = trends.length > 0 && trends.every((t: string) => t === "bullish");
        const allBearish = trends.length > 0 && trends.every((t: string) => t === "bearish");
        const bullishCount = trends.filter((t: string) => t === "bullish").length;
        const bearishCount = trends.filter((t: string) => t === "bearish").length;

        let alignment: "strong_bullish" | "bullish" | "mixed" | "bearish" | "strong_bearish" = "mixed";
        if (allBullish) alignment = "strong_bullish";
        else if (allBearish) alignment = "strong_bearish";
        else if (bullishCount >= 4) alignment = "bullish";
        else if (bearishCount >= 4) alignment = "bearish";

        const ticker = tickerMap.get(sym);
        const currentPrice = ticker ? parseFloat(ticker.lastPrice) : 0;

        results.push({
          symbol: sym,
          price: currentPrice,
          timeframes: tfResults,
          alignment,
          bullishCount,
          bearishCount,
          totalTimeframes: trends.length,
        });
      }

      mtfCache.data = results;
      mtfCache.timestamp = now;
      res.json(results);
    } catch (err) {
      console.error("Multi-timeframe error:", err);
      res.status(500).json({ message: "Failed to analyze multi-timeframe" });
    }
  });

  const volumeProfileCache: { [key: string]: { data: any; timestamp: number } } = {};
  app.get("/api/market/volume-profile/:symbol", async (req, res) => {
    try {
      const symbol = (req.params.symbol || "BTCUSDT").toUpperCase();
      const now = Date.now();
      if (volumeProfileCache[symbol] && now - volumeProfileCache[symbol].timestamp < 30000) {
        return res.json(volumeProfileCache[symbol].data);
      }

      const url = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1h&limit=200`;
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch klines");
      const data = await response.json();

      const candles = (data as any[]).map((k: any) => ({
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }));

      const currentPrice = candles[candles.length - 1].close;
      const allHighs = candles.map(c => c.high);
      const allLows = candles.map(c => c.low);
      const maxPrice = Math.max(...allHighs);
      const minPrice = Math.min(...allLows);
      const priceRange = maxPrice - minPrice;
      const numBuckets = 30;
      const bucketSize = priceRange / numBuckets;

      const volumeAtPrice: { priceLevel: number; volume: number; buyVolume: number; sellVolume: number }[] = [];
      for (let b = 0; b < numBuckets; b++) {
        const bucketLow = minPrice + b * bucketSize;
        const bucketHigh = bucketLow + bucketSize;
        const priceLevel = (bucketLow + bucketHigh) / 2;
        let totalVol = 0, buyVol = 0, sellVol = 0;

        for (const c of candles) {
          if (c.high >= bucketLow && c.low <= bucketHigh) {
            const overlap = Math.min(c.high, bucketHigh) - Math.max(c.low, bucketLow);
            const candleRange = c.high - c.low || 1;
            const fraction = overlap / candleRange;
            const vol = c.volume * fraction;
            totalVol += vol;
            if (c.close >= c.open) buyVol += vol;
            else sellVol += vol;
          }
        }

        volumeAtPrice.push({ priceLevel: +priceLevel.toFixed(8), volume: +totalVol.toFixed(4), buyVolume: +buyVol.toFixed(4), sellVolume: +sellVol.toFixed(4) });
      }

      const pocBucket = volumeAtPrice.reduce((max, b) => b.volume > max.volume ? b : max, volumeAtPrice[0]);

      let cumulativeVol = 0;
      const totalVol = volumeAtPrice.reduce((s, b) => s + b.volume, 0);
      const sortedByVol = [...volumeAtPrice].sort((a, b) => b.volume - a.volume);
      const valueArea: number[] = [];
      for (const bucket of sortedByVol) {
        cumulativeVol += bucket.volume;
        valueArea.push(bucket.priceLevel);
        if (cumulativeVol >= totalVol * 0.7) break;
      }
      const vah = Math.max(...valueArea);
      const val = Math.min(...valueArea);

      let vwap = 0;
      let vwapVol = 0;
      for (const c of candles) {
        const typicalPrice = (c.high + c.low + c.close) / 3;
        vwap += typicalPrice * c.volume;
        vwapVol += c.volume;
      }
      vwap = vwapVol > 0 ? vwap / vwapVol : currentPrice;

      const result = {
        symbol,
        currentPrice,
        vwap: +vwap.toFixed(8),
        poc: pocBucket.priceLevel,
        valueAreaHigh: +vah.toFixed(8),
        valueAreaLow: +val.toFixed(8),
        volumeAtPrice,
        priceVsVwap: currentPrice > vwap ? "above" : currentPrice < vwap ? "below" : "at",
      };

      volumeProfileCache[symbol] = { data: result, timestamp: now };
      res.json(result);
    } catch (err) {
      console.error("Volume profile error:", err);
      res.status(500).json({ message: "Failed to compute volume profile" });
    }
  });

  const momentumCache: { data: any; timestamp: number } = { data: null, timestamp: 0 };
  app.get("/api/market/momentum", async (_req, res) => {
    try {
      const now = Date.now();
      if (momentumCache.data && now - momentumCache.timestamp < 15000) {
        return res.json(momentumCache.data);
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

            if (closes.length < 21) return null;

            const currentPrice = closes[closes.length - 1];
            const ticker = tickerMap.get(sym);
            const priceChange24h = ticker ? parseFloat(ticker.priceChangePercent) : 0;

            const rsi = computeRSI(closes, 14);

            const mom1h = closes.length >= 2 ? ((currentPrice - closes[closes.length - 2]) / closes[closes.length - 2]) * 100 : 0;
            const mom4h = closes.length >= 5 ? ((currentPrice - closes[closes.length - 5]) / closes[closes.length - 5]) * 100 : 0;
            const mom12h = closes.length >= 13 ? ((currentPrice - closes[closes.length - 13]) / closes[closes.length - 13]) * 100 : 0;
            const mom24h = closes.length >= 25 ? ((currentPrice - closes[closes.length - 25]) / closes[closes.length - 25]) * 100 : 0;

            const avgVol = volumes.slice(0, -1).reduce((a: number, b: number) => a + b, 0) / (volumes.length - 1);
            const currentVol = volumes[volumes.length - 1];
            const volRatio = avgVol > 0 ? currentVol / avgVol : 1;

            let momentumScore = 0;
            if (mom1h > 0) momentumScore++;
            if (mom4h > 0) momentumScore++;
            if (mom12h > 0) momentumScore++;
            if (mom24h > 0) momentumScore++;
            if (rsi > 50) momentumScore++;
            if (volRatio > 1.5) momentumScore += (mom1h > 0 ? 1 : -1);

            let strength: "strong_up" | "up" | "neutral" | "down" | "strong_down" = "neutral";
            if (momentumScore >= 5) strength = "strong_up";
            else if (momentumScore >= 3) strength = "up";
            else if (momentumScore <= 0) strength = "strong_down";
            else if (momentumScore <= 1) strength = "down";

            return {
              symbol: sym,
              price: currentPrice,
              priceChange24h,
              rsi: +rsi.toFixed(2),
              mom1h: +mom1h.toFixed(3),
              mom4h: +mom4h.toFixed(3),
              mom12h: +mom12h.toFixed(3),
              mom24h: +mom24h.toFixed(3),
              volRatio: +volRatio.toFixed(2),
              momentumScore,
              strength,
            };
          } catch { return null; }
        });
        const batchResults = await Promise.all(promises);
        results.push(...batchResults.filter(Boolean));
      }

      results.sort((a, b) => b.momentumScore - a.momentumScore);
      momentumCache.data = results;
      momentumCache.timestamp = now;
      res.json(results);
    } catch (err) {
      console.error("Momentum error:", err);
      res.status(500).json({ message: "Failed to compute momentum" });
    }
  });

  const orderflowCache: { data: any; timestamp: number } = { data: null, timestamp: 0 };
  app.get("/api/market/orderflow", async (_req, res) => {
    try {
      const now = Date.now();
      if (orderflowCache.data && now - orderflowCache.timestamp < 10000) {
        return res.json(orderflowCache.data);
      }

      const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT"];
      const results: any[] = [];

      const promises = symbols.map(async (sym) => {
        try {
          const url = `https://data-api.binance.vision/api/v3/depth?symbol=${sym}&limit=50`;
          const response = await fetch(url);
          if (!response.ok) return null;
          const raw = await response.json() as { bids: string[][]; asks: string[][] };

          const ticker = tickerMap.get(sym);
          const currentPrice = ticker ? parseFloat(ticker.lastPrice) : 0;

          const bids = raw.bids.map(([p, q]: string[]) => ({ price: parseFloat(p), quantity: parseFloat(q), usd: parseFloat(p) * parseFloat(q) }));
          const asks = raw.asks.map(([p, q]: string[]) => ({ price: parseFloat(p), quantity: parseFloat(q), usd: parseFloat(p) * parseFloat(q) }));

          const totalBidUsd = bids.reduce((s: number, b: any) => s + b.usd, 0);
          const totalAskUsd = asks.reduce((s: number, a: any) => s + a.usd, 0);
          const totalVolume = totalBidUsd + totalAskUsd;

          const bidPct = totalVolume > 0 ? (totalBidUsd / totalVolume) * 100 : 50;
          const askPct = totalVolume > 0 ? (totalAskUsd / totalVolume) * 100 : 50;

          const imbalance = totalVolume > 0 ? ((totalBidUsd - totalAskUsd) / totalVolume) * 100 : 0;

          const nearBids = bids.filter((b: any) => b.price >= currentPrice * 0.998);
          const nearAsks = asks.filter((a: any) => a.price <= currentPrice * 1.002);
          const nearBidUsd = nearBids.reduce((s: number, b: any) => s + b.usd, 0);
          const nearAskUsd = nearAsks.reduce((s: number, a: any) => s + a.usd, 0);
          const nearTotal = nearBidUsd + nearAskUsd;
          const nearImbalance = nearTotal > 0 ? ((nearBidUsd - nearAskUsd) / nearTotal) * 100 : 0;

          let pressure: "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell" = "neutral";
          if (imbalance > 20) pressure = "strong_buy";
          else if (imbalance > 5) pressure = "buy";
          else if (imbalance < -20) pressure = "strong_sell";
          else if (imbalance < -5) pressure = "sell";

          return {
            symbol: sym,
            price: currentPrice,
            totalBidUsd: +totalBidUsd.toFixed(2),
            totalAskUsd: +totalAskUsd.toFixed(2),
            bidPct: +bidPct.toFixed(1),
            askPct: +askPct.toFixed(1),
            imbalance: +imbalance.toFixed(2),
            nearImbalance: +nearImbalance.toFixed(2),
            pressure,
          };
        } catch { return null; }
      });

      const batchResults = await Promise.all(promises);
      batchResults.forEach(r => { if (r) results.push(r); });

      orderflowCache.data = results;
      orderflowCache.timestamp = now;
      res.json(results);
    } catch (err) {
      console.error("Orderflow error:", err);
      res.status(500).json({ message: "Failed to fetch order flow" });
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
      const user = await storage.getUser(req.user!.id);
      if (!user) return res.sendStatus(401);

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

      if (user.tradingMode === "real" && user.krakenApiKey && user.krakenApiSecret) {
        const creds = { apiKey: user.krakenApiKey, apiSecret: user.krakenApiSecret };

        const orderType = data.orderType === "market" ? "MARKET" : "LIMIT";
        const orderOpts: any = {
          symbol: data.symbol,
          side: data.type === "buy" ? "BUY" : "SELL",
          type: orderType,
        };

        if (orderType === "MARKET") {
          if (data.type === "buy") {
            orderOpts.quoteOrderQty = total.toFixed(4);
          } else {
            orderOpts.quantity = data.quantity.toString();
          }
        } else {
          orderOpts.price = (data.limitPrice || data.price).toString();
          orderOpts.quantity = data.quantity.toString();
        }

        const krakenResult = await placeKrakenOrder(creds, orderOpts);
        if (!krakenResult.success) {
          return res.status(400).json({ message: `Kraken order failed: ${krakenResult.error}` });
        }

        if (data.type === "buy") {
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
          if (existing) {
            const newQty = existing.quantity - data.quantity;
            if (newQty <= 0) {
              await storage.upsertPortfolioItem(user.id, data.symbol, 0, 0);
            } else {
              await storage.upsertPortfolioItem(user.id, data.symbol, newQty, existing.avgBuyPrice);
            }
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
          orderType: data.orderType,
          limitPrice: data.limitPrice || null,
          stopPrice: data.stopPrice || null,
        });

        const txid = krakenResult.data?.txid?.[0] || "";
        storage.createNotification(
          user.id,
          data.type === "buy" ? "trade_buy" : "trade_sell",
          `[REAL] ${data.type === "buy" ? "Buy" : "Sell"} ${data.symbol}`,
          `[Kraken] ${data.type === "buy" ? "Bought" : "Sold"} ${data.quantity} ${data.symbol} at $${data.price.toLocaleString()} (Order: ${txid})`,
          JSON.stringify({ symbol: data.symbol, type: data.type, quantity: data.quantity, price: data.price, total, krakenTxid: txid, mode: "real" })
        ).catch(() => {});

        const updatedUser = await storage.getUser(user.id);
        return res.status(201).json({ trade, user: updatedUser, krakenTxid: txid, mode: "real" });
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

      storage.createNotification(
        user.id,
        data.type === "buy" ? "trade_buy" : "trade_sell",
        `${data.type === "buy" ? "Buy" : "Sell"} ${data.symbol}`,
        `${data.type === "buy" ? "Bought" : "Sold"} ${data.quantity} ${data.symbol} at $${data.price.toLocaleString()} for $${total.toFixed(2)}`,
        JSON.stringify({ symbol: data.symbol, type: data.type, quantity: data.quantity, price: data.price, total })
      ).catch(() => {});

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

  app.get("/api/user/signal-alerts", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = await storage.getUser(req.user!.id);
    res.json({ enabled: user?.signalAlertsEnabled || false });
  });

  app.post("/api/user/signal-alerts", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = await storage.getUser(req.user!.id);
    if (!user?.telegramBotToken || !user?.telegramChatId) {
      return res.status(400).json({ message: "Please configure Telegram settings first before enabling signal alerts" });
    }
    const schema = z.object({ enabled: z.boolean() });
    const { enabled } = schema.parse(req.body);
    await storage.updateSignalAlerts(req.user!.id, enabled);
    res.json({ success: true, enabled });
  });

  app.get("/api/user/trading-mode", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = await storage.getUser(req.user!.id);
    res.json({
      tradingMode: user?.tradingMode || "demo",
      hasKrakenKeys: !!(user?.krakenApiKey && user?.krakenApiSecret),
    });
  });

  app.post("/api/user/trading-mode", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const schema = z.object({ tradingMode: z.enum(["demo", "real"]) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid trading mode" });

    const user = await storage.getUser(req.user!.id);
    if (parsed.data.tradingMode === "real") {
      if (!user?.krakenApiKey || !user?.krakenApiSecret) {
        return res.status(400).json({ message: "Please configure Kraken API keys first" });
      }
    }

    await storage.updateTradingMode(req.user!.id, parsed.data.tradingMode);
    res.json({ success: true, tradingMode: parsed.data.tradingMode });
  });

  app.post("/api/user/kraken-keys", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const schema = z.object({
      apiKey: z.string().min(1),
      apiSecret: z.string().min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "All fields are required" });

    const validation = await validateKrakenCredentials({
      apiKey: parsed.data.apiKey,
      apiSecret: parsed.data.apiSecret,
    });

    if (!validation.valid) {
      return res.status(400).json({ message: `Invalid Kraken credentials: ${validation.error}` });
    }

    await storage.updateKrakenCredentials(
      req.user!.id,
      parsed.data.apiKey,
      parsed.data.apiSecret
    );
    res.json({ success: true });
  });

  app.delete("/api/user/kraken-keys", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    await storage.updateKrakenCredentials(req.user!.id, "", "");
    await storage.updateTradingMode(req.user!.id, "demo");
    res.json({ success: true });
  });

  app.get("/api/user/kraken-keys", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = await storage.getUser(req.user!.id);
    if (!user) return res.sendStatus(404);
    res.json({
      hasKeys: !!(user.krakenApiKey && user.krakenApiSecret),
      apiKey: user.krakenApiKey ? `${user.krakenApiKey.slice(0, 6)}...${user.krakenApiKey.slice(-4)}` : "",
    });
  });

  app.get("/api/kraken/balance", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = await storage.getUser(req.user!.id);
    if (!user?.krakenApiKey || !user?.krakenApiSecret) {
      return res.status(400).json({ message: "Kraken API keys not configured" });
    }

    const creds = { apiKey: user.krakenApiKey, apiSecret: user.krakenApiSecret };

    const result = await getKrakenUsdtBalance(creds);
    if (!result.success) {
      console.error(`[Kraken] Balance fetch failed: ${result.error}`);
      return res.json({
        balance: 0,
        error: result.error || "Failed to connect to Kraken"
      });
    }

    const balance = result.balance || 0;
    console.log(`[Kraken] Balance: ${balance}`);

    res.json({ balance });
  });

  app.get("/api/kraken/balances", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = await storage.getUser(req.user!.id);
    if (!user?.krakenApiKey || !user?.krakenApiSecret) {
      return res.status(400).json({ message: "Kraken API keys not configured" });
    }

    const creds = { apiKey: user.krakenApiKey, apiSecret: user.krakenApiSecret };

    const result = await getKrakenAllBalances(creds);
    const balances: { currency: string; available: number; balance: number; wallet: string }[] = [];

    if (result.success && result.balances) {
      result.balances.forEach(b => {
        balances.push({ ...b, wallet: "spot" });
      });
    }

    res.json({ balances });
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

  app.get("/api/admin/tracked-coins", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = req.user as any;
    if (!user.isAdmin) return res.status(403).json({ message: "Admin access required" });
    try {
      const coins = await storage.getTrackedCoins();
      res.json(coins.length > 0 ? coins.map(c => c.symbol) : TRACKED_SYMBOLS);
    } catch {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/admin/tracked-coins", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = req.user as any;
    if (!user.isAdmin) return res.status(403).json({ message: "Admin access required" });
    try {
      const { symbol } = z.object({ symbol: z.string().min(1) }).parse(req.body);
      const sym = symbol.toLowerCase();
      await storage.addTrackedCoin(sym);
      if (reconnectBinanceWs) reconnectBinanceWs();
      const coins = await storage.getTrackedCoins();
      res.json(coins.map(c => c.symbol));
    } catch (e) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors[0].message });
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/admin/tracked-coins/:symbol", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = req.user as any;
    if (!user.isAdmin) return res.status(403).json({ message: "Admin access required" });
    try {
      const sym = req.params.symbol.toLowerCase();
      await storage.removeTrackedCoin(sym);
      if (reconnectBinanceWs) reconnectBinanceWs();
      const coins = await storage.getTrackedCoins();
      res.json(coins.map(c => c.symbol));
    } catch {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/admin/api-keys", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = req.user as any;
    if (!user.isAdmin) return res.status(403).json({ message: "Admin access required" });
    try {
      const keys = await storage.getAllApiKeys();
      const masked = keys.map(k => ({
        keyName: k.keyName,
        apiKey: k.apiKey ? `${k.apiKey.slice(0, 6)}...${k.apiKey.slice(-4)}` : "",
        apiSecret: k.apiSecret ? `${k.apiSecret.slice(0, 4)}...${k.apiSecret.slice(-4)}` : "",
        hasKey: !!k.apiKey,
        hasSecret: !!k.apiSecret,
      }));
      res.json(masked);
    } catch {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/admin/api-keys", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = req.user as any;
    if (!user.isAdmin) return res.status(403).json({ message: "Admin access required" });
    try {
      const schema = z.object({
        keyName: z.string().min(1),
        apiKey: z.string(),
        apiSecret: z.string(),
      });
      const { keyName, apiKey, apiSecret } = schema.parse(req.body);
      await storage.upsertApiKey(keyName, apiKey, apiSecret);
      res.json({ success: true, keyName });
    } catch (e) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors[0].message });
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ---- Futures Trading Endpoints ----

  app.get("/api/futures/wallet", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = req.user as any;
    try {
      let wallet = await storage.getFuturesWallet(user.id);
      if (!wallet) {
        wallet = await storage.createFuturesWallet(user.id, 0);
      }
      res.json(wallet);
    } catch {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/futures/wallet/transfer", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = req.user as any;
    try {
      const { amount, direction } = z.object({
        amount: z.number().positive(),
        direction: z.enum(["spot_to_futures", "futures_to_spot"]),
      }).parse(req.body);

      const currentUser = await storage.getUser(user.id);
      if (!currentUser) return res.status(404).json({ message: "User not found" });

      let wallet = await storage.getFuturesWallet(user.id);
      if (!wallet) {
        wallet = await storage.createFuturesWallet(user.id, 0);
      }

      if (direction === "spot_to_futures") {
        if (currentUser.balance < amount) {
          return res.status(400).json({ message: "Insufficient spot balance" });
        }
        await storage.updateUserBalance(user.id, currentUser.balance - amount);
        await storage.updateFuturesWalletBalance(user.id, wallet.balance + amount);
      } else {
        if (wallet.balance < amount) {
          return res.status(400).json({ message: "Insufficient futures balance" });
        }
        await storage.updateFuturesWalletBalance(user.id, wallet.balance - amount);
        await storage.updateUserBalance(user.id, currentUser.balance + amount);
      }

      const updatedWallet = await storage.getFuturesWallet(user.id);
      const updatedUser = await storage.getUser(user.id);
      res.json({ futuresBalance: updatedWallet?.balance || 0, spotBalance: updatedUser?.balance || 0 });
    } catch (e) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors[0].message });
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/futures/positions", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = req.user as any;
    try {
      const positions = await storage.getOpenFuturesPositions(user.id);
      const withPnl = positions.map(pos => {
        const ticker = tickerMap.get(pos.symbol.toUpperCase());
        const currentPrice = ticker ? parseFloat(ticker.lastPrice) : pos.entryPrice;
        const notional = pos.quantity * currentPrice;
        let unrealizedPnl = 0;
        if (pos.side === "long") {
          unrealizedPnl = (currentPrice - pos.entryPrice) * pos.quantity;
        } else {
          unrealizedPnl = (pos.entryPrice - currentPrice) * pos.quantity;
        }
        const roe = pos.isolatedMargin > 0 ? (unrealizedPnl / pos.isolatedMargin) * 100 : 0;
        return { ...pos, currentPrice, notional, unrealizedPnl, roe };
      });
      res.json(withPnl);
    } catch {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/futures/positions/all", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = req.user as any;
    try {
      const positions = await storage.getFuturesPositions(user.id);
      res.json(positions);
    } catch {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/futures/positions/open", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = req.user as any;
    try {
      const schema = z.object({
        symbol: z.string().min(1),
        side: z.enum(["long", "short"]),
        quantity: z.number().positive(),
        leverage: z.number().int().min(1).max(125),
        marginMode: z.enum(["cross", "isolated"]).default("cross"),
      });
      const { symbol, side, quantity, leverage, marginMode } = schema.parse(req.body);

      const sym = symbol.toUpperCase();
      const ticker = tickerMap.get(sym);
      if (!ticker) return res.status(400).json({ message: `No price data for ${sym}` });

      const currentPrice = parseFloat(ticker.lastPrice);
      const notional = quantity * currentPrice;
      const margin = notional / leverage;
      const fee = notional * 0.0004; // 0.04% taker fee
      const totalCost = margin + fee;

      let wallet = await storage.getFuturesWallet(user.id);
      if (!wallet) {
        wallet = await storage.createFuturesWallet(user.id, 0);
      }

      if (wallet.balance < totalCost) {
        return res.status(400).json({ message: `Insufficient futures balance. Required: ${totalCost.toFixed(2)} USDT, Available: ${wallet.balance.toFixed(2)} USDT` });
      }

      if (notional < 5) {
        return res.status(400).json({ message: "Minimum position size is 5 USDT" });
      }

      // Calculate liquidation price (simplified with 1% maintenance margin)
      const maintenanceMarginRate = 0.01;
      let liquidationPrice = 0;
      if (side === "long") {
        liquidationPrice = currentPrice * (1 - (1 / leverage) + maintenanceMarginRate);
      } else {
        liquidationPrice = currentPrice * (1 + (1 / leverage) - maintenanceMarginRate);
      }

      // Deduct margin + fee from wallet
      await storage.updateFuturesWalletBalance(user.id, wallet.balance - totalCost);

      // Create position
      const position = await storage.createFuturesPosition({
        userId: user.id,
        symbol: sym,
        side,
        entryPrice: currentPrice,
        quantity,
        leverage,
        marginMode,
        isolatedMargin: margin,
        liquidationPrice: Math.max(0, liquidationPrice),
      });

      await storage.createFuturesTrade({
        userId: user.id,
        symbol: sym,
        side,
        action: "open",
        quantity,
        price: currentPrice,
        leverage,
        marginMode,
        realizedPnl: 0,
        fee,
        fundingFee: 0,
        positionId: position.id,
        closePrice: null,
      });

      storage.createNotification(
        user.id,
        "futures_open",
        `Futures ${side.toUpperCase()} ${sym}`,
        `Opened ${side} ${sym} x${leverage} - ${quantity} @ $${currentPrice.toLocaleString()} ($${notional.toFixed(2)})`,
        JSON.stringify({ symbol: sym, side, leverage, quantity, price: currentPrice, notional })
      ).catch(() => {});

      res.json({ position, fee, margin, notional });
    } catch (e) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors[0].message });
      console.error("[Futures] Open error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/futures/positions/close", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = req.user as any;
    try {
      const { positionId, quantity } = z.object({
        positionId: z.number().int(),
        quantity: z.number().positive().optional(),
      }).parse(req.body);

      const position = await storage.getFuturesPosition(positionId);
      if (!position || position.userId !== user.id) {
        return res.status(404).json({ message: "Position not found" });
      }
      if (position.status !== "open") {
        return res.status(400).json({ message: "Position is already closed" });
      }

      const ticker = tickerMap.get(position.symbol.toUpperCase());
      if (!ticker) return res.status(400).json({ message: "No price data" });

      const closePrice = parseFloat(ticker.lastPrice);
      const closeQty = quantity ? Math.min(quantity, position.quantity) : position.quantity;
      const closingNotional = closeQty * closePrice;
      const fee = closingNotional * 0.0004;

      let pnl = 0;
      if (position.side === "long") {
        pnl = (closePrice - position.entryPrice) * closeQty;
      } else {
        pnl = (position.entryPrice - closePrice) * closeQty;
      }

      const marginReturned = (closeQty / position.quantity) * position.isolatedMargin;
      let wallet = await storage.getFuturesWallet(user.id);
      if (!wallet) wallet = await storage.createFuturesWallet(user.id, 0);

      const holdDurationMs = position.openedAt ? (Date.now() - new Date(position.openedAt).getTime()) : 0;
      const fundingIntervals = Math.floor(holdDurationMs / (8 * 60 * 60 * 1000));
      const fundingRate = 0.0001;
      const notionalValue = position.entryPrice * closeQty;
      const fundingFee = fundingIntervals * fundingRate * notionalValue;

      const netReturnFinal = marginReturned + pnl - fee - fundingFee;
      await storage.updateFuturesWalletBalance(user.id, wallet.balance + netReturnFinal);

      if (closeQty >= position.quantity) {
        await storage.closeFuturesPosition(positionId);
      } else {
        const remainingQty = position.quantity - closeQty;
        const remainingMargin = position.isolatedMargin - marginReturned;
        await storage.updateFuturesPositionQuantity(positionId, remainingQty, position.entryPrice);
      }

      await storage.createFuturesTrade({
        userId: user.id,
        symbol: position.symbol,
        side: position.side,
        action: "close",
        quantity: closeQty,
        price: position.entryPrice,
        leverage: position.leverage,
        marginMode: position.marginMode,
        realizedPnl: pnl,
        fee,
        fundingFee,
        positionId: position.id,
        closePrice,
      });

      const pnlSign = pnl >= 0 ? "+" : "";
      storage.createNotification(
        user.id,
        pnl >= 0 ? "futures_profit" : "futures_loss",
        `Futures ${position.side.toUpperCase()} ${position.symbol} Closed`,
        `Closed ${position.side} ${position.symbol} x${position.leverage} - PnL: ${pnlSign}$${pnl.toFixed(2)} | Fee: $${fee.toFixed(2)}`,
        JSON.stringify({ symbol: position.symbol, side: position.side, pnl, fee, closePrice, closeQty })
      ).catch(() => {});

      res.json({ pnl, fee, fundingFee, closePrice, closeQty, netReturn: netReturnFinal });
    } catch (e) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors[0].message });
      console.error("[Futures] Close error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/futures/trades", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = req.user as any;
    try {
      const trades = await storage.getFuturesTrades(user.id);
      res.json(trades);
    } catch {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/futures/today-pnl", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const user = req.user as any;
      const now = new Date();
      const todayStart = new Date(now);
      todayStart.setHours(6, 0, 0, 0);
      if (now.getHours() < 6) {
        todayStart.setDate(todayStart.getDate() - 1);
      }

      const allTrades = await storage.getFuturesTrades(user.id);
      const todayCloseTrades = allTrades.filter((t) => {
        if (t.action !== "close") return false;
        const ts = t.timestamp ? new Date(t.timestamp) : new Date();
        return ts >= todayStart;
      });

      let totalPnl = 0;
      const perSymbol: Record<string, number> = {};
      for (const t of todayCloseTrades) {
        const netPnl = (t.realizedPnl || 0) - (t.fee || 0) - (t.fundingFee || 0);
        totalPnl += netPnl;
        perSymbol[t.symbol] = (perSymbol[t.symbol] || 0) + netPnl;
      }

      const openPositions = await storage.getOpenFuturesPositions(user.id);
      let unrealizedPnl = 0;
      for (const pos of openPositions) {
        const ticker = tickerMap.get(pos.symbol);
        const currentPrice = ticker ? parseFloat(ticker.lastPrice) : Number(pos.entryPrice);
        const qty = Number(pos.quantity);
        const entry = Number(pos.entryPrice);
        unrealizedPnl += pos.side === "long"
          ? (currentPrice - entry) * qty
          : (entry - currentPrice) * qty;
      }

      const walletData = await storage.getFuturesWallet(user.id);
      const walletBalance = walletData?.balance ?? 0;
      const currentValue = walletBalance + unrealizedPnl;

      res.json({
        totalPnl,
        perSymbol,
        unrealizedPnl,
        currentValue,
        periodStart: todayStart.toISOString(),
      });
    } catch (e) {
      console.error("Futures today PNL error:", e);
      res.status(500).json({ message: "Failed to calculate futures PNL" });
    }
  });

  app.get("/api/futures/pnl-history", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const user = req.user as any;
      const allTrades = await storage.getFuturesTrades(user.id);
      const closeTrades = allTrades.filter((t) => t.action === "close");

      if (closeTrades.length === 0) {
        return res.json({ dailyPnl: [], cumulativePnl: 0, weeklyPnl: 0 });
      }

      closeTrades.sort((a, b) => {
        const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return ta - tb;
      });

      function getTradingDayKey(ts: Date): string {
        const shifted = new Date(ts);
        if (shifted.getHours() < 6) {
          shifted.setDate(shifted.getDate() - 1);
        }
        return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}-${String(shifted.getDate()).padStart(2, "0")}`;
      }

      const dailyMap: Record<string, number> = {};
      for (const t of closeTrades) {
        const ts = t.timestamp ? new Date(t.timestamp) : new Date();
        const dayKey = getTradingDayKey(ts);
        if (!dailyMap[dayKey]) dailyMap[dayKey] = 0;
        const netPnl = (t.realizedPnl || 0) - (t.fee || 0) - (t.fundingFee || 0);
        dailyMap[dayKey] += netPnl;
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
      });
    } catch (e) {
      console.error("Futures PNL history error:", e);
      res.status(500).json({ message: "Failed to calculate futures PNL history" });
    }
  });

  // Pay: Search users by username
  app.get("/api/pay/search-users", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = req.user as any;
    const query = (req.query.q as string || "").trim();
    if (!query || query.length < 1) return res.json([]);
    try {
      const results = await storage.searchUsers(query, user.id);
      res.json(results);
    } catch (e) {
      res.status(500).json({ message: "Search failed" });
    }
  });

  // Pay: Create transfer (atomic transaction in storage)
  app.post("/api/pay/transfer", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const sender = req.user as any;
    try {
      const { receiverId, amount, note } = z.object({
        receiverId: z.number().int(),
        amount: z.number().positive().min(0.01),
        note: z.string().max(200).optional().default(""),
      }).parse(req.body);

      if (receiverId === sender.id) {
        return res.status(400).json({ message: "Cannot transfer to yourself" });
      }

      const transfer = await storage.createTransfer(sender.id, receiverId, amount, note);

      const updatedSender = await storage.getUser(sender.id);
      const receiver = await storage.getUser(receiverId);

      storage.createNotification(
        sender.id,
        "transfer_sent",
        "Transfer Sent",
        `Sent $${amount.toFixed(2)} USDT to ${receiver?.username || "Unknown"}${note ? ` - "${note}"` : ""}`,
        JSON.stringify({ transferId: transfer.id, receiverId, amount })
      ).catch(() => {});

      storage.createNotification(
        receiverId,
        "transfer_received",
        "Transfer Received",
        `Received $${amount.toFixed(2)} USDT from ${updatedSender?.username || sender.username}${note ? ` - "${note}"` : ""}`,
        JSON.stringify({ transferId: transfer.id, senderId: sender.id, amount })
      ).catch(() => {});

      res.json({
        ...transfer,
        senderUsername: updatedSender?.username || sender.username,
        receiverUsername: receiver?.username || "Unknown",
        newBalance: updatedSender?.balance ?? 0,
      });
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors[0].message });
      if (e.message === "Insufficient balance") return res.status(400).json({ message: e.message });
      if (e.message === "Recipient not found") return res.status(404).json({ message: e.message });
      console.error("Transfer error:", e);
      res.status(500).json({ message: "Transfer failed" });
    }
  });

  // Pay: Get transfer history
  app.get("/api/pay/history", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const user = req.user as any;
    try {
      const transferList = await storage.getTransfers(user.id);
      const allUsers = await storage.getAllUsers();
      const userMap: Record<number, string> = {};
      allUsers.forEach(u => { userMap[u.id] = u.username; });

      const enriched = transferList.map(t => ({
        ...t,
        senderUsername: userMap[t.senderId] || "Unknown",
        receiverUsername: userMap[t.receiverId] || "Unknown",
        direction: t.senderId === user.id ? "sent" : "received",
      }));

      enriched.sort((a, b) => {
        const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return tb - ta;
      });

      res.json(enriched);
    } catch (e) {
      console.error("Transfer history error:", e);
      res.status(500).json({ message: "Failed to fetch transfer history" });
    }
  });

  // Admin: top up futures wallet
  app.post("/api/admin/futures-topup", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const adminUser = req.user as any;
    if (!adminUser.isAdmin) return res.status(403).json({ message: "Admin access required" });
    try {
      const { userId, amount } = z.object({
        userId: z.number().int(),
        amount: z.number().positive(),
      }).parse(req.body);

      let wallet = await storage.getFuturesWallet(userId);
      if (!wallet) {
        wallet = await storage.createFuturesWallet(userId, amount);
      } else {
        await storage.updateFuturesWalletBalance(userId, wallet.balance + amount);
      }
      const updated = await storage.getFuturesWallet(userId);
      res.json({ userId, newBalance: updated?.balance || 0 });
    } catch (e) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors[0].message });
      res.status(500).json({ message: "Internal server error" });
    }
  });

  const coinAnalysisCache: { [key: string]: { data: any; timestamp: number } } = {};
  app.get("/api/market/coin-analysis/:symbol", async (req, res) => {
    try {
      const symbol = req.params.symbol.toUpperCase();
      const now = Date.now();
      if (coinAnalysisCache[symbol] && now - coinAnalysisCache[symbol].timestamp < 30000) {
        return res.json(coinAnalysisCache[symbol].data);
      }

      const ticker = tickerMap.get(symbol);
      const currentPrice = ticker ? parseFloat(ticker.lastPrice) : 0;
      const priceChange24h = ticker ? parseFloat(ticker.priceChangePercent) : 0;
      const volume24h = ticker ? parseFloat(ticker.quoteVolume) : 0;

      if (!currentPrice) {
        return res.status(404).json({ message: "Symbol not found or no live data" });
      }

      const [klinesRes, depthRes, fngRes] = await Promise.all([
        fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1h&limit=200`).then(r => r.ok ? r.json() : []),
        fetch(`https://data-api.binance.vision/api/v3/depth?symbol=${symbol}&limit=50`).then(r => r.ok ? r.json() : { bids: [], asks: [] }),
        fetch("https://api.alternative.me/fng/?limit=1&date_format=world").then(r => r.ok ? r.json() : null).catch(() => null),
      ]);

      const rawKlines = klinesRes as any[];
      if (!rawKlines || rawKlines.length < 30) {
        return res.status(503).json({ message: "Insufficient market data available. Try again shortly." });
      }

      const candles = rawKlines.map((k: any) => ({
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }));
      const closes = candles.map(c => c.close);
      const volumes = candles.map(c => c.volume);

      const rsi = computeRSI(closes, 14);
      const ema9 = computeEMAArray(closes, 9);
      const ema21 = computeEMAArray(closes, 21);
      const ema50 = computeEMAArray(closes, 50);
      const macdLine = ema9.length > 1 ? ema9[ema9.length - 1] - ema21[ema21.length - 1] : 0;
      const prevMacdLine = ema9.length > 2 ? ema9[ema9.length - 2] - ema21[ema21.length - 2] : 0;
      const avgVol = volumes.slice(0, -1).reduce((a, b) => a + b, 0) / Math.max(volumes.length - 1, 1);
      const currentVol = volumes[volumes.length - 1] || 0;
      const volRatio = avgVol > 0 ? currentVol / avgVol : 1;

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

      let signal: string = "neutral";
      if (signalScore >= 3) signal = "strong_buy";
      else if (signalScore >= 1) signal = "buy";
      else if (signalScore <= -3) signal = "strong_sell";
      else if (signalScore <= -1) signal = "sell";

      const tolerance = currentPrice * 0.005;
      const levels: { price: number; strength: number; type: string; touches: number }[] = [];
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
      const supports = levels.filter(l => l.type === "support").sort((a, b) => b.price - a.price);
      const resistances = levels.filter(l => l.type === "resistance").sort((a, b) => a.price - b.price);

      const nearestSupport = supports.length > 0 ? supports[0] : null;
      const nearestResistance = resistances.length > 0 ? resistances[0] : null;
      const nextSupportBelow = supports.length > 1 ? supports[1] : null;
      const nextResistanceAbove = resistances.length > 1 ? resistances[1] : null;

      const supportDist = nearestSupport ? ((currentPrice - nearestSupport.price) / currentPrice * 100) : null;
      const resistanceDist = nearestResistance ? ((nearestResistance.price - currentPrice) / currentPrice * 100) : null;

      let currentZone = "middle";
      if (supportDist !== null && supportDist < 2) currentZone = "near_support";
      if (resistanceDist !== null && resistanceDist < 2) currentZone = "near_resistance";
      if (supportDist !== null && supportDist < 1) currentZone = "at_support";
      if (resistanceDist !== null && resistanceDist < 1) currentZone = "at_resistance";

      let trendScore = 0;
      if (ema9[ema9.length - 1] > ema21[ema21.length - 1]) trendScore++;
      if (ema21[ema21.length - 1] > ema50[ema50.length - 1]) trendScore++;
      if (currentPrice > ema9[ema9.length - 1]) trendScore++;
      if (currentPrice > ema21[ema21.length - 1]) trendScore++;
      if (ema9[ema9.length - 1] < ema21[ema21.length - 1]) trendScore--;
      if (ema21[ema21.length - 1] < ema50[ema50.length - 1]) trendScore--;
      if (currentPrice < ema9[ema9.length - 1]) trendScore--;
      if (currentPrice < ema21[ema21.length - 1]) trendScore--;

      let trendDirection = "sideways";
      if (trendScore >= 3) trendDirection = "strong_up";
      else if (trendScore >= 1) trendDirection = "up";
      else if (trendScore <= -3) trendDirection = "strong_down";
      else if (trendScore <= -1) trendDirection = "down";

      const depth = depthRes as { bids: string[][]; asks: string[][] };
      const bidVolume = depth.bids.reduce((sum: number, [p, q]: string[]) => sum + parseFloat(p) * parseFloat(q), 0);
      const askVolume = depth.asks.reduce((sum: number, [p, q]: string[]) => sum + parseFloat(p) * parseFloat(q), 0);
      const totalDepth = bidVolume + askVolume;
      const buyPressure = totalDepth > 0 ? (bidVolume / totalDepth) * 100 : 50;

      let sentiment = "neutral";
      if (buyPressure > 60) sentiment = "bullish";
      else if (buyPressure > 55) sentiment = "slightly_bullish";
      else if (buyPressure < 40) sentiment = "bearish";
      else if (buyPressure < 45) sentiment = "slightly_bearish";

      const fngValue = fngRes?.data?.[0]?.value ? parseInt(fngRes.data[0].value) : null;
      const fngClassification = fngRes?.data?.[0]?.value_classification || null;

      let rsiExplain = "";
      if (rsi < 30) rsiExplain = "Oversold - Price has dropped a lot and may bounce back up soon";
      else if (rsi < 40) rsiExplain = "Getting low - Price is relatively cheap, potential buying area";
      else if (rsi > 70) rsiExplain = "Overbought - Price has risen a lot and may pull back soon";
      else if (rsi > 60) rsiExplain = "Getting high - Price is relatively expensive, be cautious buying";
      else rsiExplain = "Neutral - Price momentum is balanced, no extreme reading";

      let emaExplain = "";
      if (trendScore >= 3) emaExplain = "All moving averages confirm a strong uptrend";
      else if (trendScore >= 1) emaExplain = "Moving averages lean bullish, trend is moderately up";
      else if (trendScore <= -3) emaExplain = "All moving averages confirm a strong downtrend";
      else if (trendScore <= -1) emaExplain = "Moving averages lean bearish, trend is moderately down";
      else emaExplain = "Moving averages are mixed, no clear trend direction";

      let macdExplain = "";
      if (macdLine > 0 && prevMacdLine <= 0) macdExplain = "MACD just crossed bullish - new upward momentum starting";
      else if (macdLine < 0 && prevMacdLine >= 0) macdExplain = "MACD just crossed bearish - new downward momentum starting";
      else if (macdLine > 0) macdExplain = "MACD is positive - upward momentum is active";
      else if (macdLine < 0) macdExplain = "MACD is negative - downward momentum is active";
      else macdExplain = "MACD is flat - no strong momentum";

      let volumeExplain = "";
      if (volRatio > 3) volumeExplain = "Volume is extremely high (3x+ average) - big move happening";
      else if (volRatio > 2) volumeExplain = "Volume spike detected (2x average) - increased interest";
      else if (volRatio > 1.5) volumeExplain = "Volume is above average - some interest building";
      else if (volRatio < 0.5) volumeExplain = "Volume is very low - market is quiet, be cautious of fakeouts";
      else volumeExplain = "Volume is normal - nothing unusual";

      let verdict = "";
      let verdictType: "buy" | "sell" | "hold" | "caution" = "hold";
      if (signal === "strong_buy" && currentZone.includes("support")) {
        verdict = "Strong buying opportunity near support zone. Technical indicators and price position align for a potential entry.";
        verdictType = "buy";
      } else if (signal === "strong_buy") {
        verdict = "Indicators show strong buying signals, but price is not near a key support. Consider waiting for a pullback to support for a better entry.";
        verdictType = "buy";
      } else if (signal === "buy" && currentZone.includes("support")) {
        verdict = "Good potential entry point. Price is near support with positive indicators. Consider buying with a stop-loss below the support zone.";
        verdictType = "buy";
      } else if (signal === "buy") {
        verdict = "Indicators are moderately positive. Look for a dip toward the nearest support for a better entry price.";
        verdictType = "hold";
      } else if (signal === "strong_sell" && currentZone.includes("resistance")) {
        verdict = "Strong sell signal near resistance. If you hold this coin, consider taking some profits here. Not a good time to buy.";
        verdictType = "sell";
      } else if (signal === "strong_sell") {
        verdict = "Indicators are very bearish. Avoid buying. If holding, consider setting tight stop-losses.";
        verdictType = "sell";
      } else if (signal === "sell" && currentZone.includes("resistance")) {
        verdict = "Price is near resistance with negative indicators. This is not an ideal buying spot. Consider selling some holdings if profitable.";
        verdictType = "sell";
      } else if (signal === "sell") {
        verdict = "Indicators lean slightly negative. Hold off on new buys and watch for a clearer signal.";
        verdictType = "caution";
      } else {
        verdict = "Market is neutral for this coin. No strong signal in either direction. Wait for a clearer setup before entering a trade.";
        verdictType = "hold";
      }

      const response = {
        symbol,
        currentPrice,
        priceChange24h: +priceChange24h.toFixed(2),
        volume24h,
        zones: {
          currentZone,
          nearestSupport: nearestSupport ? { price: nearestSupport.price, distance: supportDist ? +supportDist.toFixed(2) : null, touches: nearestSupport.touches } : null,
          nearestResistance: nearestResistance ? { price: nearestResistance.price, distance: resistanceDist ? +resistanceDist.toFixed(2) : null, touches: nearestResistance.touches } : null,
          nextSupportBelow: nextSupportBelow ? { price: nextSupportBelow.price, touches: nextSupportBelow.touches } : null,
          nextResistanceAbove: nextResistanceAbove ? { price: nextResistanceAbove.price, touches: nextResistanceAbove.touches } : null,
          buyZone: nearestSupport ? `Around $${nearestSupport.price.toLocaleString()} (nearest support)` : "No clear support identified",
          sellZone: nearestResistance ? `Around $${nearestResistance.price.toLocaleString()} (nearest resistance)` : "No clear resistance identified",
        },
        trend: {
          direction: trendDirection,
          score: trendScore,
          explain: emaExplain,
        },
        indicators: {
          rsi: { value: +rsi.toFixed(2), explain: rsiExplain },
          macd: { value: +macdLine.toFixed(6), explain: macdExplain, crossover: macdLine > 0 && prevMacdLine <= 0, crossunder: macdLine < 0 && prevMacdLine >= 0 },
          volume: { ratio: +volRatio.toFixed(2), explain: volumeExplain },
          ema: {
            ema9: +ema9[ema9.length - 1]?.toFixed(6),
            ema21: +ema21[ema21.length - 1]?.toFixed(6),
            ema50: +ema50[ema50.length - 1]?.toFixed(6),
          },
        },
        sentiment: {
          orderBook: sentiment,
          buyPressure: +buyPressure.toFixed(1),
          bidVolume: +bidVolume.toFixed(2),
          askVolume: +askVolume.toFixed(2),
        },
        fearGreed: fngValue !== null ? { value: fngValue, classification: fngClassification } : null,
        signal: {
          overall: signal,
          score: signalScore,
        },
        verdict: {
          text: verdict,
          type: verdictType,
        },
      };

      coinAnalysisCache[symbol] = { data: response, timestamp: now };
      res.json(response);
    } catch (err) {
      console.error("Coin analysis error:", err);
      res.status(500).json({ message: "Failed to analyze coin" });
    }
  });

  // Notifications
  app.get("/api/notifications", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const notifs = await storage.getNotifications((req.user as any).id);
      res.json(notifs);
    } catch {
      res.status(500).json({ message: "Failed to fetch notifications" });
    }
  });

  app.get("/api/notifications/unread-count", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const count = await storage.getUnreadNotificationCount((req.user as any).id);
      res.json({ count });
    } catch {
      res.status(500).json({ message: "Failed to fetch count" });
    }
  });

  app.post("/api/notifications/mark-read", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const { notificationId } = z.object({ notificationId: z.number().int() }).parse(req.body);
      await storage.markNotificationRead((req.user as any).id, notificationId);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to mark read" });
    }
  });

  app.post("/api/notifications/mark-all-read", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      await storage.markAllNotificationsRead((req.user as any).id);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to mark all read" });
    }
  });

  // ===== Autopilot Bots =====
  app.get("/api/autopilot/bots", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const bots = await storage.getAutopilotBots((req.user as any).id);
      res.json(bots);
    } catch {
      res.status(500).json({ message: "Failed to fetch bots" });
    }
  });

  app.get("/api/autopilot/bots/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const bot = await storage.getAutopilotBot((req.user as any).id, Number(req.params.id));
      if (!bot) return res.status(404).json({ message: "Bot not found" });
      res.json(bot);
    } catch {
      res.status(500).json({ message: "Failed to fetch bot" });
    }
  });

  app.post("/api/autopilot/bots", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const { name, symbol, side, tradeAmount, strategy, strategyConfig } = req.body;
      if (!name || !symbol) return res.status(400).json({ message: "Name and symbol are required" });
      const bot = await storage.createAutopilotBot((req.user as any).id, {
        name,
        symbol: symbol.toUpperCase(),
        side: side || "buy",
        tradeAmount: tradeAmount || 10,
        strategy: strategy || "custom",
        strategyConfig: strategyConfig || "{}",
      });
      res.json(bot);
    } catch {
      res.status(500).json({ message: "Failed to create bot" });
    }
  });

  app.patch("/api/autopilot/bots/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const bot = await storage.updateAutopilotBot((req.user as any).id, Number(req.params.id), req.body);
      if (!bot) return res.status(404).json({ message: "Bot not found" });
      res.json(bot);
    } catch {
      res.status(500).json({ message: "Failed to update bot" });
    }
  });

  app.post("/api/autopilot/bots/:id/toggle", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const userId = (req.user as any).id;
      const botId = Number(req.params.id);
      const { isActive } = req.body;
      await storage.toggleAutopilotBot(userId, botId, isActive);

      if (isActive) {
        const bot = await storage.getAutopilotBot(userId, botId);
        if (bot) {
          setTimeout(async () => {
            try {
              await executeDcaBotCycle(bot);
              console.log(`[DCA Bot ${bot.id}] Immediate execution triggered on activation`);
            } catch (err) {
              console.error(`[DCA Bot ${bot.id}] Immediate execution failed:`, err);
            }
          }, 500);
        }
      }

      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to toggle bot" });
    }
  });

  app.delete("/api/autopilot/bots/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      await storage.deleteDcaBotOrders(Number(req.params.id));
      await storage.deleteAutopilotBot((req.user as any).id, Number(req.params.id));
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to delete bot" });
    }
  });

  app.get("/api/dca/price/:symbol", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const symbol = req.params.symbol.toUpperCase();
      const ticker = tickerMap.get(symbol);
      if (ticker) {
        return res.json({ price: parseFloat(ticker.lastPrice) });
      }
      try {
        const apiRes = await fetch(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${symbol}`);
        if (apiRes.ok) {
          const data = await apiRes.json() as any;
          const price = parseFloat(data.price) || 0;
          return res.json({ price });
        }
      } catch {}
      res.json({ price: 0 });
    } catch {
      res.json({ price: 0 });
    }
  });

  app.get("/api/dca/support-zones/:symbol", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const symbol = req.params.symbol.toUpperCase();
      let currentPrice = await fetchBinancePrice(symbol);

      let sr: any = null;
      try {
        sr = await computeSupportResistance(symbol);
      } catch (e) {
        console.error("[DCA] computeSupportResistance error:", e);
      }

      if (!currentPrice && sr) currentPrice = sr.currentPrice;

      const klineUrl = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1d&limit=30`;
      let dailyData: { close: number; low: number; high: number; volume: number }[] = [];
      try {
        const kRes = await fetch(klineUrl);
        if (kRes.ok) {
          const raw = await kRes.json();
          dailyData = (raw as any[]).map((k: any) => ({
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5]),
          }));
        }
      } catch {}

      let rsi = 50;
      if (dailyData.length >= 15) {
        const closes = dailyData.map(d => d.close);
        rsi = computeRSI(closes, 14);
      }

      res.json({
        supports: sr ? sr.supports.map((s: any) => ({ price: s.price, touches: s.touches })) : [],
        resistances: sr ? sr.resistances.map((r: any) => ({ price: r.price, touches: r.touches })) : [],
        currentPrice: currentPrice || 0,
        rsi: +rsi.toFixed(2),
        dailyData,
      });
    } catch (e) {
      console.error("[DCA] support-zones error:", e);
      res.status(500).json({ message: "Failed to fetch support zones" });
    }
  });

  app.get("/api/dca/bots/:id/orders", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const bot = await storage.getAutopilotBot((req.user as any).id, Number(req.params.id));
      if (!bot) return res.status(404).json({ message: "Bot not found" });
      const orders = await storage.getDcaBotOrders(bot.id);
      res.json(orders);
    } catch {
      res.status(500).json({ message: "Failed to fetch orders" });
    }
  });

  app.post("/api/dca/bots/:id/execute-buy", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const bodySchema = z.object({
        step: z.number().int().min(1),
        price: z.number().positive().optional(),
        orderType: z.enum(["market", "limit"]).default("market"),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid request: step (number) is required" });

      const userId = (req.user as any).id;
      const botId = Number(req.params.id);
      const bot = await storage.getAutopilotBot(userId, botId);
      if (!bot) return res.status(404).json({ message: "Bot not found" });

      let config: any = {};
      try { config = JSON.parse(bot.strategyConfig || "{}"); } catch {}
      if (config.strategy !== "dca_spot") return res.status(400).json({ message: "Not a DCA bot" });

      const { step, price: requestedPrice, orderType } = parsed.data;
      const buySteps = config.buySteps || [];
      const stepConfig = buySteps.find((s: any) => s.step === step);
      if (!stepConfig) return res.status(400).json({ message: "Invalid step" });

      const existingOrders = await storage.getDcaBotOrders(botId);
      const executedBuys = existingOrders.filter(o => o.type === "buy");
      if (executedBuys.find(o => o.step === step)) {
        return res.status(400).json({ message: "This buy step already executed" });
      }
      if (executedBuys.length >= (config.maxBuySteps || 5)) {
        return res.status(400).json({ message: "Maximum buy steps reached" });
      }

      const currentPrice = await fetchBinancePrice(bot.symbol);
      const execPrice = orderType === "limit" ? (requestedPrice || currentPrice) : currentPrice;
      if (!execPrice || execPrice <= 0) return res.status(400).json({ message: "Invalid price. Market data unavailable." });

      const totalCapital = config.totalCapital || bot.tradeAmount;
      const capitalForStep = totalCapital * (stepConfig.percent / 100);
      const quantity = capitalForStep / execPrice;
      const total = quantity * execPrice;

      const user = await storage.getUser(userId);
      if (!user) return res.status(400).json({ message: "User not found" });
      if (user.balance < total) return res.status(400).json({ message: "Insufficient balance" });

      await storage.updateUserBalance(userId, user.balance - total);

      const existing = await storage.getPortfolioItem(userId, bot.symbol);
      if (existing) {
        const newQty = existing.quantity + quantity;
        const newAvg = ((existing.avgBuyPrice * existing.quantity) + total) / newQty;
        await storage.upsertPortfolioItem(userId, bot.symbol, newQty, newAvg);
      } else {
        await storage.upsertPortfolioItem(userId, bot.symbol, quantity, execPrice);
      }

      await storage.createTrade({
        symbol: bot.symbol,
        type: "buy",
        quantity,
        price: execPrice,
        status: "completed",
        orderType: orderType || "market",
        userId,
        total,
      } as any);

      const order = await storage.createDcaBotOrder({
        botId,
        userId,
        step,
        type: "buy",
        price: execPrice,
        quantity,
        total,
      });

      await storage.incrementBotTrades(botId, 0);

      const allOrders = await storage.getDcaBotOrders(botId);
      const allBuys = allOrders.filter(o => o.type === "buy");
      const totalCost = allBuys.reduce((s, o) => s + o.total, 0);
      const totalQty = allBuys.reduce((s, o) => s + o.quantity, 0);
      const avgPrice = totalQty > 0 ? totalCost / totalQty : 0;

      res.json({
        order,
        avgPrice,
        totalCost,
        totalQuantity: totalQty,
        executedSteps: allBuys.length,
      });
    } catch (err) {
      console.error("[DCA Execute Buy]", err);
      res.status(500).json({ message: "Failed to execute buy" });
    }
  });

  app.post("/api/dca/bots/:id/execute-sell", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const sellBodySchema = z.object({
        step: z.number().int().min(1),
        price: z.number().positive().optional(),
        orderType: z.enum(["market", "limit"]).default("market"),
      });
      const parsedSell = sellBodySchema.safeParse(req.body);
      if (!parsedSell.success) return res.status(400).json({ message: "Invalid request: step (number) is required" });

      const userId = (req.user as any).id;
      const botId = Number(req.params.id);
      const bot = await storage.getAutopilotBot(userId, botId);
      if (!bot) return res.status(404).json({ message: "Bot not found" });

      let config: any = {};
      try { config = JSON.parse(bot.strategyConfig || "{}"); } catch {}
      if (config.strategy !== "dca_spot") return res.status(400).json({ message: "Not a DCA bot" });

      const { step, price: requestedPrice, orderType } = parsedSell.data;
      const sellSteps = config.sellSteps || [];
      const stepConfig = sellSteps.find((s: any) => s.step === step);
      if (!stepConfig) return res.status(400).json({ message: "Invalid sell step" });

      const existingOrders = await storage.getDcaBotOrders(botId);
      const executedSells = existingOrders.filter(o => o.type === "sell");
      if (executedSells.find(o => o.step === step)) {
        return res.status(400).json({ message: "This sell step already executed" });
      }

      const allBuys = existingOrders.filter(o => o.type === "buy");
      if (allBuys.length === 0) return res.status(400).json({ message: "No buys yet" });

      const totalBought = allBuys.reduce((s, o) => s + o.quantity, 0);
      const totalSold = executedSells.reduce((s, o) => s + o.quantity, 0);
      const remainingQty = totalBought - totalSold;
      if (remainingQty <= 0) return res.status(400).json({ message: "No position to sell" });

      const currentPrice = await fetchBinancePrice(bot.symbol);
      const execPrice = orderType === "limit" ? (requestedPrice || currentPrice) : currentPrice;
      if (!execPrice || execPrice <= 0) return res.status(400).json({ message: "Invalid price. Market data unavailable." });

      let sellQty: number;
      if (stepConfig.sellRemaining) {
        sellQty = remainingQty;
      } else {
        sellQty = totalBought * (stepConfig.percent / 100);
        if (sellQty > remainingQty) sellQty = remainingQty;
      }

      const totalCost = allBuys.reduce((s, o) => s + o.total, 0);
      const totalBoughtQty = allBuys.reduce((s, o) => s + o.quantity, 0);
      const avgBuyPrice = totalBoughtQty > 0 ? totalCost / totalBoughtQty : 0;

      const result = await executeDcaSell(bot, step, sellQty, execPrice, avgBuyPrice);
      res.json(result);
    } catch (err: any) {
      console.error("[DCA Execute Sell] Error:", err);
      res.status(500).json({ message: err.message || "Failed to execute sell" });
    }
  });

  app.post("/api/dca/bots/:id/sell-all", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const { id } = req.params;

    try {
      const userId = (req.user as any).id;
      const botId = Number(id);
      const bot = await storage.getAutopilotBot(userId, botId);
      if (!bot) return res.status(404).json({ message: "Bot not found" });

      const currentPrice = await fetchBinancePrice(bot.symbol);
      if (!currentPrice || currentPrice <= 0) {
        return res.status(400).json({ message: "Could not fetch current price" });
      }

      const orders = await storage.getDcaBotOrders(bot.id);
      const executedBuys = orders.filter((o: any) => o.type === "buy");
      const executedSells = orders.filter((o: any) => o.type === "sell");

      const totalCost = executedBuys.reduce((s: number, o: any) => s + o.total, 0);
      const totalBuyQty = executedBuys.reduce((s: number, o: any) => s + o.quantity, 0);
      const totalSoldQty = executedSells.reduce((s: number, o: any) => s + o.quantity, 0);
      const avgPrice = totalBuyQty > 0 ? totalCost / totalBuyQty : 0;
      const remainingQty = totalBuyQty - totalSoldQty;

      if (remainingQty <= 0.00000001) {
        return res.status(400).json({ message: "Nothing to sell" });
      }

      const result = await executeDcaSell(bot, 999, remainingQty, currentPrice, avgPrice);
      res.json(result);
    } catch (err: any) {
      console.error("[DCA Sell All] Error:", err);
      res.status(500).json({ message: err.message || "Failed to sell all" });
    }
  });

  app.post("/api/dca/bots/:id/reset", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const userId = (req.user as any).id;
      const botId = Number(req.params.id);
      const bot = await storage.getAutopilotBot(userId, botId);
      if (!bot) return res.status(404).json({ message: "Bot not found" });
      await storage.deleteDcaBotOrders(botId);
      await storage.updateAutopilotBot(userId, botId, { totalTrades: 0, totalPnl: 0 } as any);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to reset bot" });
    }
  });

  return httpServer;
}
