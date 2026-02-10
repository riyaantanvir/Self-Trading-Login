import { createHmac } from "crypto";

const KUCOIN_BASE_URL = "https://api.kucoin.com";

interface KucoinCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
}

function generateSignature(
  secret: string,
  timestamp: string,
  method: string,
  endpoint: string,
  body: string = ""
): string {
  const message = timestamp + method.toUpperCase() + endpoint + body;
  return createHmac("sha256", secret).update(message).digest("base64");
}

function encryptPassphrase(passphrase: string, secret: string): string {
  return createHmac("sha256", secret).update(passphrase).digest("base64");
}

function getHeaders(
  creds: KucoinCredentials,
  method: string,
  endpoint: string,
  body: string = ""
) {
  const timestamp = Date.now().toString();
  const signature = generateSignature(creds.apiSecret, timestamp, method, endpoint, body);
  const encPassphrase = encryptPassphrase(creds.passphrase, creds.apiSecret);
  return {
    "KC-API-KEY": creds.apiKey,
    "KC-API-SIGN": signature,
    "KC-API-TIMESTAMP": timestamp,
    "KC-API-PASSPHRASE": encPassphrase,
    "KC-API-KEY-VERSION": "2",
    "Content-Type": "application/json",
  };
}

export interface KucoinBalance {
  currency: string;
  balance: string;
  available: string;
  holds: string;
}

export interface KucoinOrderResult {
  orderId: string;
}

export async function getKucoinAccounts(
  creds: KucoinCredentials
): Promise<{ success: boolean; data?: KucoinBalance[]; error?: string }> {
  try {
    const endpoint = "/api/v1/accounts?type=trade";
    const headers = getHeaders(creds, "GET", endpoint);
    const res = await fetch(KUCOIN_BASE_URL + endpoint, { method: "GET", headers });
    const json = await res.json() as any;
    if (json.code === "200000") {
      return { success: true, data: json.data };
    }
    return { success: false, error: json.msg || "KuCoin API error" };
  } catch (err: any) {
    console.error("[KuCoin] getAccounts error:", err);
    return { success: false, error: err.message || "Network error" };
  }
}

export async function getKucoinUsdtBalance(
  creds: KucoinCredentials
): Promise<{ success: boolean; balance?: number; error?: string }> {
  const result = await getKucoinAccounts(creds);
  if (!result.success || !result.data) {
    return { success: false, error: result.error };
  }
  const usdtAccount = result.data.find((a) => a.currency === "USDT");
  return {
    success: true,
    balance: usdtAccount ? parseFloat(usdtAccount.available) : 0,
  };
}

export async function getKucoinAllBalances(
  creds: KucoinCredentials
): Promise<{ success: boolean; balances?: { currency: string; available: number; balance: number }[]; error?: string }> {
  const result = await getKucoinAccounts(creds);
  if (!result.success || !result.data) {
    return { success: false, error: result.error };
  }
  const balances = result.data
    .filter((a) => parseFloat(a.balance) > 0)
    .map((a) => ({
      currency: a.currency,
      available: parseFloat(a.available),
      balance: parseFloat(a.balance),
    }));
  return { success: true, balances };
}

function convertSymbolToKucoin(binanceSymbol: string): string {
  const upper = binanceSymbol.toUpperCase();
  if (upper.endsWith("USDT")) {
    const base = upper.slice(0, -4);
    return `${base}-USDT`;
  }
  if (upper.endsWith("BTC")) {
    const base = upper.slice(0, -3);
    return `${base}-BTC`;
  }
  return upper;
}

export async function placeKucoinOrder(
  creds: KucoinCredentials,
  options: {
    symbol: string;
    side: "buy" | "sell";
    type: "market" | "limit";
    size?: string;
    funds?: string;
    price?: string;
  }
): Promise<{ success: boolean; data?: KucoinOrderResult; error?: string }> {
  try {
    const endpoint = "/api/v1/orders";
    const kucoinSymbol = convertSymbolToKucoin(options.symbol);
    const body: any = {
      clientOid: Date.now().toString() + Math.random().toString(36).slice(2, 8),
      side: options.side,
      symbol: kucoinSymbol,
      type: options.type,
    };

    if (options.type === "market") {
      if (options.side === "buy" && options.funds) {
        body.funds = options.funds;
      } else if (options.size) {
        body.size = options.size;
      }
    } else {
      body.price = options.price;
      body.size = options.size;
    }

    const bodyStr = JSON.stringify(body);
    const headers = getHeaders(creds, "POST", endpoint, bodyStr);
    const res = await fetch(KUCOIN_BASE_URL + endpoint, {
      method: "POST",
      headers,
      body: bodyStr,
    });
    const json = await res.json() as any;
    if (json.code === "200000") {
      return { success: true, data: json.data };
    }
    return { success: false, error: json.msg || "Order placement failed" };
  } catch (err: any) {
    console.error("[KuCoin] placeOrder error:", err);
    return { success: false, error: err.message || "Network error" };
  }
}

export async function getKucoinOrderDetail(
  creds: KucoinCredentials,
  orderId: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const endpoint = `/api/v1/orders/${orderId}`;
    const headers = getHeaders(creds, "GET", endpoint);
    const res = await fetch(KUCOIN_BASE_URL + endpoint, { method: "GET", headers });
    const json = await res.json() as any;
    if (json.code === "200000") {
      return { success: true, data: json.data };
    }
    return { success: false, error: json.msg || "Failed to get order" };
  } catch (err: any) {
    console.error("[KuCoin] getOrder error:", err);
    return { success: false, error: err.message || "Network error" };
  }
}

export async function getKucoinTicker(
  symbol: string
): Promise<{ success: boolean; price?: number; error?: string }> {
  try {
    const kucoinSymbol = convertSymbolToKucoin(symbol);
    const endpoint = `/api/v1/market/orderbook/level1?symbol=${kucoinSymbol}`;
    const res = await fetch(KUCOIN_BASE_URL + endpoint);
    const json = await res.json() as any;
    if (json.code === "200000" && json.data) {
      return { success: true, price: parseFloat(json.data.price) };
    }
    return { success: false, error: json.msg || "Ticker not found" };
  } catch (err: any) {
    return { success: false, error: err.message || "Network error" };
  }
}

export async function validateKucoinCredentials(
  creds: KucoinCredentials
): Promise<{ valid: boolean; error?: string }> {
  const result = await getKucoinAccounts(creds);
  if (result.success) {
    return { valid: true };
  }
  return { valid: false, error: result.error };
}

export { convertSymbolToKucoin };
