import { createHmac } from "crypto";

const BINANCE_BASE_URL = "https://api.binance.com";

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

export async function getBinanceAccountInfo(
  creds: BinanceCredentials
): Promise<{ success: boolean; balances?: BinanceBalance[]; error?: string }> {
  try {
    const signedParams = buildSignedParams(creds);
    const url = `${BINANCE_BASE_URL}/api/v3/account?${signedParams}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { "X-MBX-APIKEY": creds.apiKey },
    });
    const json = await res.json() as any;
    if (json.code && json.msg) {
      console.error("[Binance] API error:", json.code, json.msg);
      return { success: false, error: json.msg };
    }
    const nonZero = (json.balances || []).filter((b: any) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
    console.log("[Binance] Spot balances with funds:", JSON.stringify(nonZero));
    return { success: true, balances: json.balances || [] };
  } catch (err: any) {
    console.error("[Binance] getAccountInfo error:", err);
    return { success: false, error: err.message || "Network error" };
  }
}

export async function getBinanceFundingBalance(
  creds: BinanceCredentials
): Promise<{ success: boolean; balances?: { asset: string; free: string; locked: string; freeze: string }[]; error?: string }> {
  try {
    const signedParams = buildSignedParams(creds);
    const url = `${BINANCE_BASE_URL}/sapi/v1/asset/get-funding-asset?${signedParams}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-MBX-APIKEY": creds.apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: signedParams,
    });
    const json = await res.json() as any;
    if (json.code && json.msg) {
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
  return {
    success: true,
    balance: usdtAccount ? parseFloat(usdtAccount.free) : 0,
  };
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
    const url = `${BINANCE_BASE_URL}/api/v3/order`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-MBX-APIKEY": creds.apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: signedParams,
    });
    const json = await res.json() as any;
    if (json.code && json.msg) {
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
    const params: Record<string, string> = {
      symbol: symbol.toUpperCase(),
      orderId: orderId.toString(),
    };
    const signedParams = buildSignedParams(creds, params);
    const url = `${BINANCE_BASE_URL}/api/v3/order?${signedParams}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { "X-MBX-APIKEY": creds.apiKey },
    });
    const json = await res.json() as any;
    if (json.code && json.msg) {
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
): Promise<{ valid: boolean; error?: string }> {
  const result = await getBinanceAccountInfo(creds);
  if (result.success) {
    return { valid: true };
  }
  return { valid: false, error: result.error };
}
