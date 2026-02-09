import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { setupAuth, hashPassword } from "./auth";
import { z } from "zod";

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

const COIN_IDS = [
  "bitcoin", "ethereum", "binancecoin", "ripple", "solana",
  "cardano", "dogecoin", "polkadot", "tron", "chainlink",
  "avalanche-2", "uniswap", "litecoin", "cosmos", "ethereum-classic",
  "stellar", "near", "algorand", "filecoin", "polygon-ecosystem-token"
];

const COIN_SYMBOL_MAP: Record<string, string> = {
  "bitcoin": "BTCUSDT",
  "ethereum": "ETHUSDT",
  "binancecoin": "BNBUSDT",
  "ripple": "XRPUSDT",
  "solana": "SOLUSDT",
  "cardano": "ADAUSDT",
  "dogecoin": "DOGEUSDT",
  "polkadot": "DOTUSDT",
  "tron": "TRXUSDT",
  "chainlink": "LINKUSDT",
  "avalanche-2": "AVAXUSDT",
  "uniswap": "UNIUSDT",
  "litecoin": "LTCUSDT",
  "cosmos": "ATOMUSDT",
  "ethereum-classic": "ETCUSDT",
  "stellar": "XLMUSDT",
  "near": "NEARUSDT",
  "algorand": "ALGOUSDT",
  "filecoin": "FILUSDT",
  "polygon-ecosystem-token": "POLUSDT",
};

let tickerCache: any[] = [];
let lastFetchTime = 0;
const CACHE_TTL = 10000;

async function fetchCoinGeckoTickers() {
  const now = Date.now();
  if (tickerCache.length > 0 && now - lastFetchTime < CACHE_TTL) {
    return tickerCache;
  }

  try {
    const ids = COIN_IDS.join(",");
    const url = `${COINGECKO_BASE}/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&per_page=20&page=1&sparkline=false&price_change_percentage=24h`;
    const response = await fetch(url);
    if (!response.ok) {
      console.error("CoinGecko API error:", response.status, await response.text());
      return tickerCache;
    }
    const data = await response.json();

    tickerCache = (data as any[]).map((coin: any) => {
      const symbol = COIN_SYMBOL_MAP[coin.id] || `${coin.symbol.toUpperCase()}USDT`;
      return {
        symbol,
        lastPrice: String(coin.current_price || 0),
        priceChangePercent: String(coin.price_change_percentage_24h || 0),
        highPrice: String(coin.high_24h || 0),
        lowPrice: String(coin.low_24h || 0),
        volume: String(coin.total_volume || 0),
        quoteVolume: String(coin.total_volume || 0),
      };
    });
    lastFetchTime = now;
    return tickerCache;
  } catch (err) {
    console.error("CoinGecko fetch error:", err);
    return tickerCache;
  }
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

  app.get("/api/market/tickers", async (_req, res) => {
    try {
      const tickers = await fetchCoinGeckoTickers();
      res.json(tickers);
    } catch (err) {
      console.error("Market data error:", err);
      res.status(502).json({ message: "Failed to fetch market data" });
    }
  });

  // Trades
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

  // Portfolio
  app.get("/api/portfolio", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const items = await storage.getPortfolio(req.user!.id);
    res.json(items.filter(i => i.quantity > 0));
  });

  return httpServer;
}
