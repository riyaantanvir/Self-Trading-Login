import { createHmac, createHash } from "crypto";

const KRAKEN_API_URL = "https://api.kraken.com";

export interface KrakenCredentials {
  apiKey: string;
  apiSecret: string;
}

function getKrakenSignature(urlPath: string, data: Record<string, string>, secret: string): string {
  const postData = new URLSearchParams(data).toString();
  const encoded = Buffer.from(data.nonce + postData);
  const sha256Hash = createHash("sha256").update(encoded).digest();
  const message = Buffer.concat([Buffer.from(urlPath), sha256Hash]);
  const hmac = createHmac("sha512", Buffer.from(secret, "base64"));
  return hmac.update(message).digest("base64");
}

async function krakenRequest(
  creds: KrakenCredentials,
  urlPath: string,
  params: Record<string, string> = {}
): Promise<{ success: boolean; result?: any; error?: string }> {
  try {
    const data: Record<string, string> = {
      nonce: Date.now().toString(),
      ...params,
    };

    const signature = getKrakenSignature(urlPath, data, creds.apiSecret);
    const postData = new URLSearchParams(data).toString();

    const res = await fetch(KRAKEN_API_URL + urlPath, {
      method: "POST",
      headers: {
        "API-Key": creds.apiKey,
        "API-Sign": signature,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: postData,
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[Kraken] HTTP ${res.status}: ${text.substring(0, 300)}`);
      return { success: false, error: `HTTP ${res.status}: ${text.substring(0, 100)}` };
    }

    const json = await res.json() as any;

    if (json.error && json.error.length > 0) {
      const errorMsg = json.error.join(", ");
      console.error(`[Kraken] API error: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }

    return { success: true, result: json.result };
  } catch (err: any) {
    console.error(`[Kraken] Request error (${urlPath}):`, err.message);
    return { success: false, error: err.message || "Network error" };
  }
}

const SYMBOL_MAP: Record<string, string> = {
  BTC: "XBT",
};

function toKrakenSymbol(symbol: string, overrideQuote?: string): string {
  const base = symbol.replace(/USDT$/, "").replace(/USDC$/, "").replace(/USD$/, "");
  const quote = overrideQuote || (symbol.endsWith("USDT") ? "USDT" : symbol.endsWith("USDC") ? "USDC" : "USD");
  const krakenBase = SYMBOL_MAP[base] || base;
  return `${krakenBase}${quote}`;
}

async function detectQuoteCurrency(creds: KrakenCredentials): Promise<string> {
  const result = await getKrakenBalance(creds);
  if (!result.success || !result.balances) return "USDT";

  const usdtBal = parseFloat(result.balances["USDT"] || "0");
  const usdcBal = parseFloat(result.balances["USDC"] || "0");
  const usdBal = parseFloat(result.balances["ZUSD"] || result.balances["USD"] || "0");

  if (usdcBal >= usdtBal && usdcBal >= usdBal) return "USDC";
  if (usdBal >= usdtBal && usdBal >= usdcBal) return "USD";
  return "USDT";
}

function fromKrakenAsset(asset: string): string {
  // Common Kraken asset mappings
  const KRAKEN_TO_STANDARD: Record<string, string> = {
    "XXBT": "BTC",
    "XBT": "BTC",
    "XETH": "ETH",
    "XXRP": "XRP",
    "XSOL": "SOL",
    "ZUSD": "USD",
    "ZEUR": "EUR",
    "USDT": "USDT",
    "USDC": "USDC",
  };

  if (KRAKEN_TO_STANDARD[asset]) return KRAKEN_TO_STANDARD[asset];
  
  // Handle Kraken's X/Z prefixes for other assets
  if (asset.startsWith("X") && asset.length === 4) return asset.substring(1);
  if (asset.startsWith("Z") && asset.length === 4) return asset.substring(1);
  return asset;
}

export async function getKrakenBalance(
  creds: KrakenCredentials
): Promise<{ success: boolean; balances?: Record<string, string>; error?: string }> {
  const result = await krakenRequest(creds, "/0/private/Balance");
  if (!result.success) {
    return { success: false, error: result.error };
  }
  
  // Create a normalized balance object to prevent double counting
  // Kraken returns both standard and "X/Z" prefixed assets in some cases
  const normalized: Record<string, string> = {};
  for (const [asset, val] of Object.entries(result.result || {})) {
    const standardName = fromKrakenAsset(asset);
    const quantity = parseFloat(val as string);
    if (quantity === 0) continue;
    
    // We only take the FIRST non-zero balance we see for a standard name
    // to avoid double counting if Kraken returns both XBT and XXBT (unlikely but possible)
    if (!normalized[standardName]) {
      normalized[standardName] = val as string;
    }
  }

  console.log("[Kraken] Normalized balances:", JSON.stringify(normalized));
  return { success: true, balances: normalized };
}

export async function getKrakenUsdtBalance(
  creds: KrakenCredentials
): Promise<{ success: boolean; balance?: number; error?: string }> {
  const result = await getKrakenBalance(creds);
  if (!result.success || !result.balances) {
    return { success: false, error: result.error };
  }
  let total = 0;
  const usdtBalance = result.balances["USDT"] || result.balances["usdt"];
  const usdcBalance = result.balances["USDC"] || result.balances["usdc"];
  const usdBalance = result.balances["ZUSD"] || result.balances["USD"] || result.balances["zusd"] || result.balances["usd"];
  if (usdtBalance) total += parseFloat(usdtBalance);
  if (usdcBalance) total += parseFloat(usdcBalance);
  if (usdBalance) total += parseFloat(usdBalance);
  return { success: true, balance: total };
}

export async function getKrakenAllBalances(
  creds: KrakenCredentials
): Promise<{ success: boolean; balances?: { currency: string; available: number; balance: number }[]; error?: string }> {
  const result = await getKrakenBalance(creds);
  if (!result.success || !result.balances) {
    return { success: false, error: result.error };
  }
  const balances = Object.entries(result.balances)
    .filter(([, val]) => parseFloat(val) > 0)
    .map(([asset, val]) => ({
      currency: fromKrakenAsset(asset),
      available: parseFloat(val),
      balance: parseFloat(val),
    }));
  return { success: true, balances };
}

export async function placeKrakenOrder(
  creds: KrakenCredentials,
  options: {
    symbol: string;
    side: "BUY" | "SELL";
    type: "MARKET" | "LIMIT";
    quantity?: string;
    quoteOrderQty?: string;
    price?: string;
  }
): Promise<{ success: boolean; data?: { txid: string[]; description: string }; error?: string }> {
  const quoteCurrency = await detectQuoteCurrency(creds);
  const pair = toKrakenSymbol(options.symbol, quoteCurrency);
  console.log(`[Kraken] Detected quote currency: ${quoteCurrency}, using pair: ${pair}`);

  const params: Record<string, string> = {
    pair,
    type: options.side.toLowerCase(),
    ordertype: options.type.toLowerCase(),
  };

  if (options.quantity) {
    params.volume = options.quantity;
  }

  if (options.type === "LIMIT" && options.price) {
    params.price = options.price;
  }

  if (options.type === "MARKET" && options.side === "BUY" && options.quoteOrderQty) {
    params.volume = options.quoteOrderQty;
    params.oflags = "viqc";
  }

  console.log(`[Kraken] Placing order: ${JSON.stringify(params)}`);

  const result = await krakenRequest(creds, "/0/private/AddOrder", params);
  if (!result.success) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    data: {
      txid: result.result?.txid || [],
      description: result.result?.descr?.order || "",
    },
  };
}

export async function getKrakenOrderDetail(
  creds: KrakenCredentials,
  txid: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  const result = await krakenRequest(creds, "/0/private/QueryOrders", {
    txid,
  });
  if (!result.success) {
    return { success: false, error: result.error };
  }
  return { success: true, data: result.result };
}

export async function fetchKrakenClosedOrders(
  creds: KrakenCredentials
): Promise<{ success: boolean; orders?: any; error?: string }> {
  const result = await krakenRequest(creds, "/0/private/ClosedOrders");
  if (!result.success) {
    return { success: false, error: result.error };
  }
  return { success: true, orders: result.result?.closed || {} };
}

export async function validateKrakenCredentials(
  creds: KrakenCredentials
): Promise<{ valid: boolean; error?: string }> {
  console.log("[Kraken] Validating credentials...");
  const result = await krakenRequest(creds, "/0/private/Balance");
  if (!result.success) {
    console.error("[Kraken] Validation failed:", result.error);
    return { valid: false, error: result.error };
  }
  const assetCount = Object.keys(result.result || {}).length;
  console.log(`[Kraken] Validation successful, ${assetCount} assets found`);
  return { valid: true };
}
