import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { usePortfolio, useTickers, useTodayPnl } from "@/hooks/use-trades";
import { useBinanceWebSocket } from "@/hooks/use-binance-ws";
import { useAuth } from "@/hooks/use-auth";
import { LayoutShell } from "@/components/layout-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQuery } from "@tanstack/react-query";
import {
  Loader2,
  Search,
  Eye,
  EyeOff,
  ArrowLeftRight,
} from "lucide-react";

const COIN_NAMES: Record<string, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  BNB: "BNB",
  XRP: "XRP",
  SOL: "Solana",
  ADA: "Cardano",
  DOGE: "Dogecoin",
  DOT: "Polkadot",
  TRX: "TRON",
  LINK: "Chainlink",
  AVAX: "Avalanche",
  UNI: "Uniswap",
  LTC: "Litecoin",
  ATOM: "Cosmos",
  ETC: "Ethereum Classic",
  XLM: "Stellar",
  NEAR: "NEAR Protocol",
  ALGO: "Algorand",
  FIL: "Filecoin",
  POL: "Polygon",
  USDT: "Tether",
  USDC: "USD Coin",
};

const COIN_COLORS: Record<string, string> = {
  BTC: "bg-[#F7931A]",
  ETH: "bg-[#627EEA]",
  BNB: "bg-[#F3BA2F]",
  XRP: "bg-[#23292F]",
  SOL: "bg-[#9945FF]",
  ADA: "bg-[#0033AD]",
  DOGE: "bg-[#C2A633]",
  DOT: "bg-[#E6007A]",
  TRX: "bg-[#EF0027]",
  LINK: "bg-[#2A5ADA]",
  AVAX: "bg-[#E84142]",
  UNI: "bg-[#FF007A]",
  LTC: "bg-[#345D9D]",
  ATOM: "bg-[#2E3148]",
  ETC: "bg-[#328332]",
  XLM: "bg-[#14B6E7]",
  NEAR: "bg-[#00C08B]",
  ALGO: "bg-[#000000]",
  FIL: "bg-[#0090FF]",
  POL: "bg-[#8247E5]",
  USDT: "bg-[#26A17B]",
  USDC: "bg-[#2775CA]",
};

interface Ticker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
}

interface PortfolioItem {
  id: number;
  userId: number;
  symbol: string;
  quantity: number;
  avgBuyPrice: number;
}

export default function AssetsPage() {
  const { user } = useAuth();
  const { data: holdings, isLoading: loadingPortfolio } = usePortfolio();
  const { data: tickers, isLoading: loadingTickers } = useTickers();
  const { data: todayPnlData } = useTodayPnl();
  const { priceFlashes } = useBinanceWebSocket();
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [search, setSearch] = useState("");
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<"overview" | "futures">("overview");

  const { data: futuresWalletData } = useQuery({
    queryKey: ["/api/futures/wallet"],
    enabled: activeTab === "futures",
  });
  const { data: futuresPositionsData } = useQuery({
    queryKey: ["/api/futures/positions"],
    enabled: activeTab === "futures",
  });

  const futuresBalance = (futuresWalletData as any)?.balance ?? 0;
  const futuresPositions = (futuresPositionsData as any[]) ?? [];

  const tickerMap = useMemo(() => {
    const map: Record<string, Ticker> = {};
    if (tickers) {
      (tickers as Ticker[]).forEach((t) => {
        map[t.symbol] = t;
      });
    }
    return map;
  }, [tickers]);

  const portfolioItems = useMemo(() => {
    if (!holdings) return [];
    return (holdings as PortfolioItem[])
      .filter((h) => h.quantity > 0)
      .map((h) => {
        const ticker = tickerMap[h.symbol];
        const currentPrice = ticker ? parseFloat(ticker.lastPrice) : 0;
        const currentValue = h.quantity * currentPrice;
        const symPnl = todayPnlData?.perSymbol?.[h.symbol] ?? 0;
        const holdingValue = h.quantity * currentPrice;
        const symStartValue = holdingValue - symPnl;
        const symPnlPercent = symStartValue > 0 ? (symPnl / symStartValue) * 100 : 0;
        const coinName = h.symbol.replace("USDT", "");
        return {
          ...h,
          coinName,
          fullName: COIN_NAMES[coinName] || coinName,
          colorClass: COIN_COLORS[coinName] || "bg-muted",
          currentPrice,
          currentValue,
          todayPnl: symPnl,
          todayPnlPercent: symPnlPercent,
          avgBuyPrice: h.avgBuyPrice,
        };
      })
      .sort((a, b) => b.currentValue - a.currentValue);
  }, [holdings, tickerMap, todayPnlData]);

  const filteredItems = useMemo(() => {
    if (!search) return portfolioItems;
    const q = search.toLowerCase();
    return portfolioItems.filter(
      (i) =>
        i.coinName.toLowerCase().includes(q) ||
        i.fullName.toLowerCase().includes(q)
    );
  }, [portfolioItems, search]);

  const cashBalance = user?.balance || 0;

  const totalHoldingsValue = portfolioItems.reduce(
    (sum, i) => sum + i.currentValue,
    0
  );
  const totalEstValue = cashBalance + totalHoldingsValue;

  const totalTodayPnl = todayPnlData?.totalPnl ?? 0;
  const startOfDayValue = todayPnlData?.startOfDayValue ?? totalEstValue;
  const totalTodayPnlPercent =
    startOfDayValue > 0
      ? (totalTodayPnl / startOfDayValue) * 100
      : 0;

  if (loadingPortfolio || loadingTickers) {
    return (
      <LayoutShell>
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="w-10 h-10 animate-spin text-[#0ecb81]" />
        </div>
      </LayoutShell>
    );
  }

  function formatAmount(val: number, decimals = 2) {
    if (!balanceVisible) return "****";
    return val.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  function formatQuantity(val: number) {
    if (!balanceVisible) return "****";
    if (val >= 1000) return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (val >= 1) return val.toFixed(4);
    return val.toFixed(8);
  }

  return (
    <LayoutShell>
      <div className="p-4 md:p-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-4 mb-6 border-b border-border pb-3 overflow-x-auto">
          <button
            className={`text-base font-semibold pb-2 whitespace-nowrap ${activeTab === "overview" ? "text-foreground border-b-2 border-[#0ecb81]" : "text-muted-foreground"}`}
            onClick={() => setActiveTab("overview")}
            data-testid="tab-overview"
          >
            Overview
          </button>
          <button
            className={`text-base font-semibold pb-2 whitespace-nowrap ${activeTab === "futures" ? "text-foreground border-b-2 border-[#f0b90b]" : "text-muted-foreground"}`}
            onClick={() => setActiveTab("futures")}
            data-testid="tab-futures"
          >
            Futures
          </button>
          <button
            className="text-base text-muted-foreground pb-2 whitespace-nowrap cursor-not-allowed opacity-50"
            disabled
            data-testid="tab-spot"
          >
            Spot
          </button>
          <button
            className="text-base text-muted-foreground pb-2 whitespace-nowrap cursor-not-allowed opacity-50"
            disabled
            data-testid="tab-earn"
          >
            Earn
          </button>
        </div>

        {activeTab === "futures" ? (
          <FuturesAssetsContent
            futuresBalance={futuresBalance}
            futuresPositions={futuresPositions}
            tickers={tickers}
            tickerMap={tickerMap}
            balanceVisible={balanceVisible}
            setBalanceVisible={setBalanceVisible}
            formatAmount={formatAmount}
            navigate={navigate}
          />
        ) : (
        <>
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm text-muted-foreground">Est. Total Value</span>
            <button
              onClick={() => setBalanceVisible(!balanceVisible)}
              className="text-muted-foreground"
              data-testid="button-toggle-balance"
            >
              {balanceVisible ? (
                <Eye className="w-4 h-4" />
              ) : (
                <EyeOff className="w-4 h-4" />
              )}
            </button>
          </div>
          <div className="flex items-baseline gap-2 mb-1 flex-wrap">
            <span className="text-2xl sm:text-3xl font-bold text-foreground font-mono" data-testid="text-total-value">
              {formatAmount(totalEstValue)}
            </span>
            <span className="text-base sm:text-lg text-muted-foreground">USDT</span>
          </div>
          <div className="text-sm text-muted-foreground mb-1" data-testid="text-total-usd">
            {balanceVisible ? `~ $${formatAmount(totalEstValue)}` : "~ $****"}
          </div>
          <div
            className="flex flex-wrap items-center gap-1 text-sm cursor-pointer group"
            onClick={() => navigate("/pnl")}
            data-testid="link-today-pnl"
          >
            <span className="text-muted-foreground group-hover:underline">Today's PNL</span>
            <span
              className={`font-mono font-medium group-hover:underline text-xs sm:text-sm ${totalTodayPnl >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]"}`}
              data-testid="text-today-pnl"
            >
              {balanceVisible
                ? `${totalTodayPnl >= 0 ? "+" : ""}${formatAmount(totalTodayPnl)} USDT (${totalTodayPnl >= 0 ? "+" : ""}${totalTodayPnlPercent.toFixed(2)}%)`
                : "****"}
            </span>
          </div>
        </div>

        <div className="flex gap-3 mb-8">
          <Button
            variant="default"
            className="bg-[#0ecb81] text-black font-semibold border-[#0ecb81]"
            onClick={() => navigate("/")}
            data-testid="button-add-funds"
          >
            Add Funds
          </Button>
          <Button variant="outline" data-testid="button-send" disabled>
            Send
          </Button>
          <Button variant="outline" data-testid="button-transfer" disabled>
            Transfer
          </Button>
        </div>

        <div className="mb-4">
          <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
            <div className="flex items-center gap-4">
              <span className="text-sm font-semibold text-foreground border-b-2 border-[#0ecb81] pb-1">
                Crypto
              </span>
            </div>
            <div className="relative w-full sm:w-56">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-card border-border font-mono text-sm"
                data-testid="input-search-assets"
              />
            </div>
          </div>

          <div
            className="rounded-md border border-border bg-card p-4 mb-3 hover-elevate cursor-pointer"
            onClick={() => navigate("/")}
            data-testid="card-asset-USDT"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-[#26A17B] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                  $
                </div>
                <div>
                  <div className="font-semibold text-foreground">USDT</div>
                  <div className="text-xs text-muted-foreground">Tether</div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono font-semibold text-foreground" data-testid="text-quantity-USDT">
                  {formatQuantity(cashBalance)}
                </div>
                <div className="text-xs text-muted-foreground font-mono">
                  {formatAmount(cashBalance)} USDT
                </div>
              </div>
            </div>
          </div>

          {filteredItems.map((item) => {
            const flash = priceFlashes.get(item.symbol);
            return (
              <div
                key={item.symbol}
                className={`rounded-md border border-border bg-card p-4 mb-3 hover-elevate cursor-pointer transition-colors duration-300 ${
                  flash === "up"
                    ? "bg-[#0ecb81]/5"
                    : flash === "down"
                    ? "bg-[#f6465d]/5"
                    : ""
                }`}
                onClick={() =>
                  navigate(`/trade/${item.symbol.toLowerCase()}`)
                }
                data-testid={`card-asset-${item.coinName}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-9 h-9 rounded-full ${item.colorClass} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}
                    >
                      {item.coinName.charAt(0)}
                    </div>
                    <div>
                      <div className="font-semibold text-foreground">
                        {item.coinName}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {item.fullName}
                      </div>
                      <div className="flex flex-col mt-1 min-w-0">
                        <div className="flex items-center gap-1 sm:gap-2 text-[10px] sm:text-xs flex-wrap">
                          <span className="text-muted-foreground">PNL</span>
                          <span
                            className={`font-mono truncate ${item.todayPnl >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]"}`}
                          >
                            {balanceVisible
                              ? `${item.todayPnl >= 0 ? "+" : ""}${item.todayPnl.toFixed(2)} (${item.todayPnlPercent >= 0 ? "+" : ""}${item.todayPnlPercent.toFixed(2)}%)`
                              : "****"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 sm:gap-2 text-[10px] sm:text-xs">
                          <span className="text-muted-foreground">Avg</span>
                          <span className="font-mono text-muted-foreground truncate">
                            {balanceVisible
                              ? `${item.avgBuyPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`
                              : "****"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-mono font-semibold text-foreground" data-testid={`text-quantity-${item.coinName}`}>
                      {formatQuantity(item.quantity)}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {formatAmount(item.currentValue)} USDT
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 mt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                    disabled
                    data-testid={`button-earn-${item.coinName}`}
                  >
                    Earn
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/trade/${item.symbol.toLowerCase()}`);
                    }}
                    data-testid={`button-trade-${item.coinName}`}
                  >
                    Trade
                  </Button>
                </div>
              </div>
            );
          })}

          {filteredItems.length === 0 && portfolioItems.length > 0 && (
            <div className="text-center text-muted-foreground py-8 text-sm">
              No assets found matching your search.
            </div>
          )}

          {portfolioItems.length === 0 && (
            <div className="text-center text-muted-foreground py-8 text-sm">
              No crypto holdings yet. Buy some coins from the Market to see them here.
            </div>
          )}
        </div>
        </>
        )}
      </div>
    </LayoutShell>
  );
}

function FuturesAssetsContent({
  futuresBalance,
  futuresPositions,
  tickers,
  tickerMap,
  balanceVisible,
  setBalanceVisible,
  formatAmount,
  navigate,
}: {
  futuresBalance: number;
  futuresPositions: any[];
  tickers: any;
  tickerMap: Record<string, Ticker>;
  balanceVisible: boolean;
  setBalanceVisible: (v: boolean) => void;
  formatAmount: (val: number, decimals?: number) => string;
  navigate: (path: string) => void;
}) {
  const openPositions = futuresPositions.filter((p: any) => p.status === "open");

  const unrealizedPnl = openPositions.reduce((sum: number, pos: any) => {
    const ticker = tickerMap[pos.symbol];
    const currentPrice = ticker ? parseFloat(ticker.lastPrice) : Number(pos.entryPrice);
    const qty = Number(pos.quantity);
    const entry = Number(pos.entryPrice);
    const pnl = pos.side === "long"
      ? (currentPrice - entry) * qty
      : (entry - currentPrice) * qty;
    return sum + pnl;
  }, 0);

  const totalMargin = openPositions.reduce((sum: number, pos: any) => sum + (Number(pos.isolatedMargin) || (Number(pos.entryPrice) * Number(pos.quantity) / Number(pos.leverage))), 0);
  const totalFuturesValue = futuresBalance + unrealizedPnl;

  return (
    <>
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm text-muted-foreground">Futures Account</span>
          <button
            onClick={() => setBalanceVisible(!balanceVisible)}
            className="text-muted-foreground"
            data-testid="button-toggle-futures-balance"
          >
            {balanceVisible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>
        </div>
        <div className="flex items-baseline gap-2 mb-1 flex-wrap">
          <span className="text-2xl sm:text-3xl font-bold text-foreground font-mono" data-testid="text-futures-total">
            {balanceVisible ? formatAmount(totalFuturesValue) : "****"}
          </span>
          <span className="text-base sm:text-lg text-muted-foreground">USDT</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
          <div className="rounded-md border border-border bg-card p-3">
            <div className="text-[10px] text-muted-foreground mb-0.5">Available Balance</div>
            <div className="font-mono text-sm font-semibold text-foreground" data-testid="text-futures-available">
              {balanceVisible ? formatAmount(futuresBalance) : "****"} USDT
            </div>
          </div>
          <div className="rounded-md border border-border bg-card p-3">
            <div className="text-[10px] text-muted-foreground mb-0.5">Unrealized PnL</div>
            <div className={`font-mono text-sm font-semibold ${unrealizedPnl >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]"}`} data-testid="text-futures-upnl">
              {balanceVisible ? `${unrealizedPnl >= 0 ? "+" : ""}${formatAmount(unrealizedPnl)}` : "****"} USDT
            </div>
          </div>
          <div className="rounded-md border border-border bg-card p-3">
            <div className="text-[10px] text-muted-foreground mb-0.5">Margin In Use</div>
            <div className="font-mono text-sm font-semibold text-[#f0b90b]" data-testid="text-futures-margin">
              {balanceVisible ? formatAmount(totalMargin) : "****"} USDT
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-3 mb-8">
        <Button
          variant="default"
          className="bg-[#f0b90b] text-black font-semibold border-[#f0b90b]"
          onClick={() => {
            try {
              localStorage.setItem("trading_mode", "futures");
              window.dispatchEvent(new Event("trading_mode_changed"));
            } catch {}
            navigate("/trade/btcusdt");
          }}
          data-testid="button-futures-trade"
        >
          Trade Futures
        </Button>
        <Button
          variant="outline"
          onClick={() => navigate("/history")}
          data-testid="button-futures-history"
        >
          <ArrowLeftRight className="w-4 h-4 mr-1" />
          History
        </Button>
      </div>

      <div className="mb-4">
        <div className="text-sm font-semibold text-foreground mb-3 border-b-2 border-[#f0b90b] pb-1 inline-block">
          Open Positions ({openPositions.length})
        </div>

        {openPositions.length === 0 ? (
          <div className="text-center text-muted-foreground py-8 text-sm">
            No open futures positions. Switch to Futures mode on any coin's trading page to open a position.
          </div>
        ) : (
          openPositions.map((pos: any) => {
            const coinName = pos.symbol.replace("USDT", "");
            const ticker = tickerMap[pos.symbol];
            const currentPrice = ticker ? parseFloat(ticker.lastPrice) : Number(pos.entryPrice);
            const qty = Number(pos.quantity);
            const entry = Number(pos.entryPrice);
            const margin = Number(pos.isolatedMargin) || (entry * qty / Number(pos.leverage));
            const pnl = pos.side === "long"
              ? (currentPrice - entry) * qty
              : (entry - currentPrice) * qty;
            const roe = margin > 0 ? (pnl / margin) * 100 : 0;
            const colorClass = COIN_COLORS[coinName] || "bg-muted";

            return (
              <div
                key={pos.id}
                className="rounded-md border border-border bg-card p-4 mb-3 hover-elevate cursor-pointer"
                onClick={() => navigate(`/trade/${pos.symbol.toLowerCase()}`)}
                data-testid={`card-futures-position-${pos.id}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-full ${colorClass} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
                      {coinName.charAt(0)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">{coinName}/USDT</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${pos.side === "long" ? "bg-[#0ecb81]/20 text-[#0ecb81]" : "bg-[#f6465d]/20 text-[#f6465d]"}`}>
                          {pos.side.toUpperCase()} {pos.leverage}x
                        </span>
                        <span className="text-[10px] text-muted-foreground">{pos.marginMode}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-[10px]">
                        <span className="text-muted-foreground">Entry: <span className="text-foreground font-mono">${Number(entry).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
                        <span className="text-muted-foreground">Mark: <span className="text-foreground font-mono">${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-[10px]">
                        <span className="text-muted-foreground">Liq: <span className="text-[#f6465d] font-mono">${Number(pos.liquidationPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
                        <span className="text-muted-foreground">Size: <span className="font-mono text-foreground">{qty.toFixed(6)} {coinName}</span></span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className={`font-mono font-semibold ${pnl >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]"}`} data-testid={`text-futures-pnl-${pos.id}`}>
                      {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)} USDT
                    </div>
                    <div className={`text-xs font-mono ${roe >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>
                      ROE {roe >= 0 ? "+" : ""}{roe.toFixed(2)}%
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                      Margin: {margin.toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
