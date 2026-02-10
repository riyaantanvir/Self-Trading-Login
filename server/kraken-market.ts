const KRAKEN_API = "https://api.kraken.com";
const KRAKEN_WS_URL = "wss://ws.kraken.com/v2";

const BINANCE_TO_KRAKEN_BASE: Record<string, string> = {
  BTC: "XBT",
  DOGE: "XDG",
};

const KRAKEN_TO_BINANCE_BASE: Record<string, string> = {
  XBT: "BTC",
  XXBT: "BTC",
  XDG: "DOGE",
  XXDG: "DOGE",
  XETH: "ETH",
  XLTC: "LTC",
  XXLM: "XLM",
  XXRP: "XRP",
};

export function binanceSymbolToKrakenPair(binanceSymbol: string): string {
  const upper = binanceSymbol.toUpperCase();
  const base = upper.replace(/USDT$/, "").replace(/USD$/, "");
  const krakenBase = BINANCE_TO_KRAKEN_BASE[base] || base;
  return `${krakenBase}/USD`;
}

export function binanceSymbolToKrakenRestPair(binanceSymbol: string): string {
  const upper = binanceSymbol.toUpperCase();
  const base = upper.replace(/USDT$/, "").replace(/USD$/, "");
  const krakenBase = BINANCE_TO_KRAKEN_BASE[base] || base;
  return `${krakenBase}USD`;
}

export function krakenPairToBinanceSymbol(krakenPair: string): string {
  const clean = krakenPair.replace("/", "");
  let base = clean.replace(/Z?USD$/, "").replace(/USDT$/, "");
  if (base.startsWith("X") && base.length >= 4) {
    const mapped = KRAKEN_TO_BINANCE_BASE[base];
    if (mapped) base = mapped;
    else base = base.substring(1);
  }
  const mapped = KRAKEN_TO_BINANCE_BASE[base] || base;
  return `${mapped}USDT`;
}

export function krakenResponseKeyToBinanceSymbol(key: string): string {
  for (const [krak, binBase] of Object.entries(KRAKEN_TO_BINANCE_BASE)) {
    if (key.startsWith(krak)) {
      return `${binBase}USDT`;
    }
  }
  let base = key;
  if (base.endsWith("ZUSD")) base = base.slice(0, -4);
  else if (base.endsWith("USD")) base = base.slice(0, -3);
  else if (base.endsWith("USDT")) base = base.slice(0, -4);
  if (base.startsWith("X") && base.length >= 4) base = base.substring(1);
  return `${base.toUpperCase()}USDT`;
}

const INTERVAL_MAP: Record<string, number> = {
  "1m": 1, "3m": 5, "5m": 5, "15m": 15, "30m": 30,
  "1h": 60, "2h": 60, "4h": 240, "6h": 240, "8h": 240,
  "12h": 720, "1d": 1440, "3d": 10080, "1w": 10080, "1M": 21600,
};

export function binanceIntervalToKraken(interval: string): number {
  return INTERVAL_MAP[interval] || 60;
}

export { KRAKEN_WS_URL };

const restCache = new Map<string, { data: any; ts: number }>();

async function cachedFetch(url: string, ttlMs: number = 5000): Promise<any> {
  const cached = restCache.get(url);
  if (cached && Date.now() - cached.ts < ttlMs) return cached.data;
  const res = await fetch(url);
  if (!res.ok) {
    if (cached) return cached.data;
    throw new Error(`Kraken API error: ${res.status}`);
  }
  const json = await res.json() as any;
  if (json.error && json.error.length > 0) {
    if (cached) return cached.data;
    throw new Error(`Kraken API: ${json.error.join(", ")}`);
  }
  restCache.set(url, { data: json.result, ts: Date.now() });
  return json.result;
}

export interface TickerData {
  symbol: string;
  lastPrice: string;
  openPrice: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
}

export async function fetchKrakenTicker(binanceSymbol: string): Promise<TickerData | null> {
  try {
    const pair = binanceSymbolToKrakenRestPair(binanceSymbol);
    const result = await cachedFetch(`${KRAKEN_API}/0/public/Ticker?pair=${pair}`, 3000);
    const key = Object.keys(result)[0];
    if (!key) return null;
    const t = result[key];
    const lastPrice = t.c[0];
    const openPrice = t.o;
    const open = parseFloat(openPrice);
    const close = parseFloat(lastPrice);
    const changePercent = open > 0 ? ((close - open) / open) * 100 : 0;
    const vol = t.v[1];
    const vwap = parseFloat(t.p[1] || "0");
    const quoteVol = (parseFloat(vol) * vwap).toFixed(2);
    return {
      symbol: binanceSymbol.toUpperCase(),
      lastPrice,
      openPrice,
      priceChangePercent: changePercent.toFixed(2),
      highPrice: t.h[1],
      lowPrice: t.l[1],
      volume: vol,
      quoteVolume: quoteVol,
    };
  } catch (e) {
    return null;
  }
}

export async function fetchKrakenPrice(binanceSymbol: string): Promise<number> {
  try {
    const pair = binanceSymbolToKrakenRestPair(binanceSymbol);
    const result = await cachedFetch(`${KRAKEN_API}/0/public/Ticker?pair=${pair}`, 3000);
    const key = Object.keys(result)[0];
    if (!key) return 0;
    return parseFloat(result[key].c[0]) || 0;
  } catch {
    return 0;
  }
}

export async function fetchKrakenOHLC(
  binanceSymbol: string,
  binanceInterval: string = "1h",
  limit: number = 200
): Promise<any[]> {
  try {
    const pair = binanceSymbolToKrakenRestPair(binanceSymbol);
    const interval = binanceIntervalToKraken(binanceInterval);
    const url = `${KRAKEN_API}/0/public/OHLC?pair=${pair}&interval=${interval}`;
    const result = await cachedFetch(url, 10000);
    const key = Object.keys(result).find(k => k !== "last");
    if (!key) return [];
    const candles = result[key];
    const sliced = candles.slice(-limit);
    return sliced.map((c: any) => [
      c[0] * 1000,
      c[1],
      c[2],
      c[3],
      c[4],
      c[6],
      c[0] * 1000 + (interval * 60000) - 1,
      c[7].toString(),
      0,
      "0",
      "0",
    ]);
  } catch {
    return [];
  }
}

export async function fetchKrakenOHLCCloses(
  binanceSymbol: string,
  binanceInterval: string = "1h",
  limit: number = 200
): Promise<number[]> {
  try {
    const pair = binanceSymbolToKrakenRestPair(binanceSymbol);
    const interval = binanceIntervalToKraken(binanceInterval);
    const url = `${KRAKEN_API}/0/public/OHLC?pair=${pair}&interval=${interval}`;
    const result = await cachedFetch(url, 10000);
    const key = Object.keys(result).find(k => k !== "last");
    if (!key) return [];
    const candles = result[key];
    return candles.slice(-limit).map((c: any) => parseFloat(c[4]));
  } catch {
    return [];
  }
}

export async function fetchKrakenDepth(
  binanceSymbol: string,
  limit: number = 100
): Promise<{ bids: any[]; asks: any[] }> {
  try {
    const pair = binanceSymbolToKrakenRestPair(binanceSymbol);
    const url = `${KRAKEN_API}/0/public/Depth?pair=${pair}&count=${limit}`;
    const result = await cachedFetch(url, 5000);
    const key = Object.keys(result)[0];
    if (!key) return { bids: [], asks: [] };
    const data = result[key];
    return {
      bids: (data.bids || []).map((b: any) => [b[0], b[1]]),
      asks: (data.asks || []).map((a: any) => [a[0], a[1]]),
    };
  } catch {
    return { bids: [], asks: [] };
  }
}

export async function fetchKrakenAllTickers(binanceSymbols: string[]): Promise<TickerData[]> {
  const pairs = binanceSymbols.map(s => binanceSymbolToKrakenRestPair(s)).join(",");
  try {
    const result = await cachedFetch(`${KRAKEN_API}/0/public/Ticker?pair=${pairs}`, 3000);
    const tickers: TickerData[] = [];
    for (const [key, t] of Object.entries(result) as [string, any][]) {
      const binSym = krakenResponseKeyToBinanceSymbol(key);
      const lastPrice = t.c[0];
      const openPrice = t.o;
      const open = parseFloat(openPrice);
      const close = parseFloat(lastPrice);
      const changePercent = open > 0 ? ((close - open) / open) * 100 : 0;
      const vol = t.v[1];
      const vwap = parseFloat(t.p[1] || "0");
      const quoteVol = (parseFloat(vol) * vwap).toFixed(2);
      tickers.push({
        symbol: binSym,
        lastPrice,
        openPrice,
        priceChangePercent: changePercent.toFixed(2),
        highPrice: t.h[1],
        lowPrice: t.l[1],
        volume: vol,
        quoteVolume: quoteVol,
      });
    }
    return tickers;
  } catch (e) {
    console.error("[Kraken Market] Failed to fetch tickers:", e);
    return [];
  }
}
