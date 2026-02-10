import { createHmac } from "crypto";

const BINANCE_COM_URL = "https://api.binance.com";
const BINANCE_US_URL = "https://api.binance.us";

interface BinanceCredentials {
  apiKey: string;
  apiSecret: string;
}

function generateSignature(secret: string, queryString: string): string {
  return createHmac("sha256", secret).update(queryString).digest("hex");
}

function buildSignedParams(creds: BinanceCredentials, params: Record<string, string> = {}): string {
  params.timestamp = Date.now().toString();
  params.recvWindow = "10000";
  const queryString = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  const signature = generateSignature(creds.apiSecret, queryString);
  return `${queryString}&signature=${signature}`;
}

export interface BinanceBalance {
  asset: string;
  free: string;
  locked: string;
}

export interface BinanceOrderResult {
  orderId: number;
  symbol: string;
  status: string;
  executedQty: string;
  cummulativeQuoteQty: string;
}

const detectedPlatformCache = new Map<string, string>();

async function tryGetAccountInfo(
  creds: BinanceCredentials,
  baseUrl: string
): Promise<{ success: boolean; balances?: BinanceBalance[]; error?: string; platform?: string }> {
  try {
    const signedParams = buildSignedParams(creds);
    const url = `${baseUrl}/api/v3/account?${signedParams}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { "X-MBX-APIKEY": creds.apiKey },
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[Binance] ${baseUrl} tryGetAccountInfo HTTP ${res.status}: ${text.substring(0, 200)}`);
      return { success: false, error: `HTTP ${res.status}: Geo-restricted or invalid credentials` };
    }
    const json = await res.json() as any;
    if (json.msg !== undefined) {
      return { success: false, error: json.msg };
    }
    const nonZero = (json.balances || []).filter((b: any) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
    return { success: true, balances: json.balances || [], platform: baseUrl };
  } catch (err: any) {
    return { success: false, error: err.message || "Network error" };
  }
}

export async function detectPlatform(creds: BinanceCredentials): Promise<string> {
  const cached = detectedPlatformCache.get(creds.apiKey);
  if (cached) return cached;

  const [comResult, usResult] = await Promise.all([
    tryGetAccountInfo(creds, BINANCE_COM_URL),
    tryGetAccountInfo(creds, BINANCE_US_URL),
  ]);

  console.log(`[Binance] Platform detection - binance.com: ${comResult.success ? 'OK' : comResult.error}, binance.us: ${usResult.success ? 'OK' : usResult.error}`);

  if (comResult.success) {
    const nonZero = (comResult.balances || []).filter((b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
    if (nonZero.length > 0) {
      console.log(`[Binance] Detected platform: binance.com (found ${nonZero.length} assets with funds)`);
      detectedPlatformCache.set(creds.apiKey, BINANCE_COM_URL);
      return BINANCE_COM_URL;
    }
  }

  if (usResult.success) {
    const nonZero = (usResult.balances || []).filter((b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
    if (nonZero.length > 0) {
      console.log(`[Binance] Detected platform: binance.us (found ${nonZero.length} assets with funds)`);
      detectedPlatformCache.set(creds.apiKey, BINANCE_US_URL);
      return BINANCE_US_URL;
    }
    console.log("[Binance] Keys valid on binance.us but no funds found");
    detectedPlatformCache.set(creds.apiKey, BINANCE_US_URL);
    return BINANCE_US_URL;
  }

  if (comResult.success) {
    console.log("[Binance] Keys valid on binance.com but no funds found");
    detectedPlatformCache.set(creds.apiKey, BINANCE_COM_URL);
    return BINANCE_COM_URL;
  }

  const isGeoBlocked = (comResult.error || '').includes('451') || (comResult.error || '').includes('Geo-restricted');
  if (isGeoBlocked) {
    console.warn("[Binance] binance.com is geo-restricted from this server location. Try binance.us API keys instead.");
  }

  console.log("[Binance] Could not detect platform, defaulting to binance.com");
  return BINANCE_COM_URL;
}

export function clearPlatformCache(apiKey: string) {
  detectedPlatformCache.delete(apiKey);
}

export async function getBinanceAccountInfo(
  creds: BinanceCredentials
): Promise<{ success: boolean; balances?: BinanceBalance[]; error?: string; detectedUrl?: string }> {
  try {
    const baseUrl = await detectPlatform(creds);
    const signedParams = buildSignedParams(creds);
    const url = `${baseUrl}/api/v3/account?${signedParams}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { "X-MBX-APIKEY": creds.apiKey },
    });
    const rawText = await res.text();
    console.log(`[Binance] ${baseUrl} - Raw response status: ${res.status}, length: ${rawText.length}`);
    console.log(`[Binance] ${baseUrl} - Raw response (first 500 chars):`, rawText.substring(0, 500));
    let json: any;
    try {
      json = JSON.parse(rawText);
    } catch (e) {
      console.error("[Binance] Failed to parse response as JSON");
      return { success: false, error: "Invalid response from Binance API" };
    }
    if (!res.ok || json.msg !== undefined) {
      console.error("[Binance] API error:", res.status, json.code, json.msg);
      return { success: false, error: json.msg || `HTTP ${res.status}` };
    }
    const allBalances = json.balances || [];
    const nonZero = allBalances.filter((b: any) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
    console.log(`[Binance] ${baseUrl} - canTrade=${json.canTrade}, accountType=${json.accountType}, totalAssets=${allBalances.length}, nonZero=${nonZero.length}`);
    if (nonZero.length > 0) {
      console.log(`[Binance] ${baseUrl} - Assets with funds:`, JSON.stringify(nonZero));
    }
    return { success: true, balances: allBalances, detectedUrl: baseUrl };
  } catch (err: any) {
    console.error("[Binance] getAccountInfo error:", err);
    return { success: false, error: err.message || "Network error" };
  }
}

export async function getBinanceFundingBalance(
  creds: BinanceCredentials
): Promise<{ success: boolean; balances?: { asset: string; free: string; locked: string; freeze: string }[]; error?: string }> {
  try {
    const baseUrl = await detectPlatform(creds);
    const signedParams = buildSignedParams(creds);
    const url = `${baseUrl}/sapi/v1/asset/get-funding-asset?${signedParams}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-MBX-APIKEY": creds.apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: signedParams,
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("[Binance] Funding API HTTP error:", res.status, text.substring(0, 200));
      return { success: false, error: `HTTP ${res.status}` };
    }
    const json = await res.json() as any;
    if (json.msg !== undefined) {
      console.error("[Binance] Funding API error:", json.code, json.msg);
      return { success: false, error: json.msg };
    }
    console.log("[Binance] Funding balances:", JSON.stringify(json));
    return { success: true, balances: json };
  } catch (err: any) {
    console.error("[Binance] getFundingBalance error:", err);
    return { success: false, error: err.message || "Network error" };
  }
}

export async function getBinanceUsdtBalance(
  creds: BinanceCredentials
): Promise<{ success: boolean; balance?: number; error?: string }> {
  const result = await getBinanceAccountInfo(creds);
  if (!result.success || !result.balances) {
    return { success: false, error: result.error };
  }
  const usdtAccount = result.balances.find((b) => b.asset === "USDT");
  const usdBalance = result.balances.find((b) => b.asset === "USD");
  let total = 0;
  if (usdtAccount) total += parseFloat(usdtAccount.free);
  if (usdBalance) total += parseFloat(usdBalance.free);
  return { success: true, balance: total };
}

export async function getBinanceAllBalances(
  creds: BinanceCredentials
): Promise<{ success: boolean; balances?: { currency: string; available: number; balance: number }[]; error?: string }> {
  const result = await getBinanceAccountInfo(creds);
  if (!result.success || !result.balances) {
    return { success: false, error: result.error };
  }
  const balances = result.balances
    .filter((b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
    .map((b) => ({
      currency: b.asset,
      available: parseFloat(b.free),
      balance: parseFloat(b.free) + parseFloat(b.locked),
    }));
  return { success: true, balances };
}

export async function placeBinanceOrder(
  creds: BinanceCredentials,
  options: {
    symbol: string;
    side: "BUY" | "SELL";
    type: "MARKET" | "LIMIT";
    quantity?: string;
    quoteOrderQty?: string;
    price?: string;
    timeInForce?: string;
  }
): Promise<{ success: boolean; data?: BinanceOrderResult; error?: string }> {
  try {
    const baseUrl = await detectPlatform(creds);
    const params: Record<string, string> = {
      symbol: options.symbol.toUpperCase(),
      side: options.side,
      type: options.type,
    };

    if (options.type === "MARKET") {
      if (options.side === "BUY" && options.quoteOrderQty) {
        params.quoteOrderQty = options.quoteOrderQty;
      } else if (options.quantity) {
        params.quantity = options.quantity;
      }
    } else {
      params.timeInForce = options.timeInForce || "GTC";
      if (options.price) params.price = options.price;
      if (options.quantity) params.quantity = options.quantity;
    }

    const signedParams = buildSignedParams(creds, params);
    const url = `${baseUrl}/api/v3/order`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-MBX-APIKEY": creds.apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: signedParams,
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("[Binance] placeOrder HTTP error:", res.status, text.substring(0, 200));
      return { success: false, error: `HTTP ${res.status}: Order failed` };
    }
    const json = await res.json() as any;
    if (json.msg !== undefined) {
      return { success: false, error: json.msg };
    }
    return { success: true, data: json };
  } catch (err: any) {
    console.error("[Binance] placeOrder error:", err);
    return { success: false, error: err.message || "Network error" };
  }
}

export async function getBinanceOrderDetail(
  creds: BinanceCredentials,
  symbol: string,
  orderId: number
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const baseUrl = await detectPlatform(creds);
    const params: Record<string, string> = {
      symbol: symbol.toUpperCase(),
      orderId: orderId.toString(),
    };
    const signedParams = buildSignedParams(creds, params);
    const url = `${baseUrl}/api/v3/order?${signedParams}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { "X-MBX-APIKEY": creds.apiKey },
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("[Binance] getOrder HTTP error:", res.status, text.substring(0, 200));
      return { success: false, error: `HTTP ${res.status}` };
    }
    const json = await res.json() as any;
    if (json.msg !== undefined) {
      return { success: false, error: json.msg };
    }
    return { success: true, data: json };
  } catch (err: any) {
    console.error("[Binance] getOrder error:", err);
    return { success: false, error: err.message || "Network error" };
  }
}

export async function validateBinanceCredentials(
  creds: BinanceCredentials
): Promise<{ valid: boolean; error?: string; platform?: string }> {
  clearPlatformCache(creds.apiKey);

  const comResult = await tryGetAccountInfo(creds, BINANCE_COM_URL);
  if (comResult.success) {
    const nonZero = (comResult.balances || []).filter((b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
    if (nonZero.length > 0) {
      detectedPlatformCache.set(creds.apiKey, BINANCE_COM_URL);
      console.log("[Binance] Validated on binance.com with funds");
      return { valid: true, platform: "binance.com" };
    }
  }

  const usResult = await tryGetAccountInfo(creds, BINANCE_US_URL);
  if (usResult.success) {
    detectedPlatformCache.set(creds.apiKey, BINANCE_US_URL);
    console.log("[Binance] Validated on binance.us");
    return { valid: true, platform: "binance.us" };
  }

  if (comResult.success) {
    detectedPlatformCache.set(creds.apiKey, BINANCE_COM_URL);
    console.log("[Binance] Validated on binance.com (no funds detected)");
    return { valid: true, platform: "binance.com" };
  }

  const combinedError = comResult.error || usResult.error || "Invalid credentials";
  const isGeoBlocked = combinedError.includes('451') || combinedError.includes('Geo-restricted');
  if (isGeoBlocked && !usResult.success) {
    return { valid: false, error: "Binance.com is geo-restricted from this server. If you use Binance.US, enter those API keys instead." };
  }
  return { valid: false, error: combinedError };
}
