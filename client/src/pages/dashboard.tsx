import { useState, useMemo } from "react";
import { useTickers } from "@/hooks/use-trades";
import { useBinanceWebSocket } from "@/hooks/use-binance-ws";
import { LayoutShell } from "@/components/layout-shell";
import { TradeDialog } from "@/components/new-trade-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, ArrowUpDown, Wifi, WifiOff } from "lucide-react";

interface Ticker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
}

export default function Dashboard() {
  const { data: tickers, isLoading } = useTickers();
  const { connected, priceFlashes } = useBinanceWebSocket();
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<"symbol" | "lastPrice" | "priceChangePercent" | "quoteVolume">("quoteVolume");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [tradeSymbol, setTradeSymbol] = useState("");
  const [tradePrice, setTradePrice] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);

  const filteredTickers = useMemo(() => {
    if (!tickers) return [];
    let list = (tickers as Ticker[]).filter((t) =>
      t.symbol.toLowerCase().includes(search.toLowerCase())
    );
    list.sort((a, b) => {
      let va: number, vb: number;
      if (sortField === "symbol") {
        return sortDir === "asc" ? a.symbol.localeCompare(b.symbol) : b.symbol.localeCompare(a.symbol);
      }
      va = parseFloat((a as any)[sortField]);
      vb = parseFloat((b as any)[sortField]);
      return sortDir === "asc" ? va - vb : vb - va;
    });
    return list;
  }, [tickers, search, sortField, sortDir]);

  function handleSort(field: typeof sortField) {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  function openTrade(ticker: Ticker) {
    setTradeSymbol(ticker.symbol);
    setTradePrice(parseFloat(ticker.lastPrice));
    setDialogOpen(true);
  }

  function formatPrice(price: string) {
    const num = parseFloat(price);
    if (num >= 1000) return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (num >= 1) return num.toFixed(4);
    return num.toFixed(8);
  }

  function formatVolume(vol: string) {
    const num = parseFloat(vol);
    if (num >= 1e9) return (num / 1e9).toFixed(2) + "B";
    if (num >= 1e6) return (num / 1e6).toFixed(2) + "M";
    if (num >= 1e3) return (num / 1e3).toFixed(2) + "K";
    return num.toFixed(2);
  }

  if (isLoading && !tickers) {
    return (
      <LayoutShell>
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="w-10 h-10 animate-spin text-[#0ecb81]" />
        </div>
      </LayoutShell>
    );
  }

  return (
    <LayoutShell>
      <div className="p-4 md:p-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground" data-testid="text-page-title">Markets</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Real-time prices from Binance
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search coin..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-card border-border font-mono text-sm"
              data-testid="input-search"
            />
          </div>
        </div>

        <div className="rounded-md border border-border overflow-hidden bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left p-3 text-xs text-muted-foreground font-medium">
                    <button onClick={() => handleSort("symbol")} className="flex items-center gap-1" data-testid="button-sort-pair">
                      Pair <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">
                    <button onClick={() => handleSort("lastPrice")} className="flex items-center gap-1 ml-auto" data-testid="button-sort-price">
                      Price <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">
                    <button onClick={() => handleSort("priceChangePercent")} className="flex items-center gap-1 ml-auto" data-testid="button-sort-change">
                      24h Change <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium hidden md:table-cell">24h High</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium hidden md:table-cell">24h Low</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium hidden sm:table-cell">
                    <button onClick={() => handleSort("quoteVolume")} className="flex items-center gap-1 ml-auto" data-testid="button-sort-volume">
                      24h Volume <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredTickers.map((ticker) => {
                  const change = parseFloat(ticker.priceChangePercent);
                  const isPositive = change >= 0;
                  const coinName = ticker.symbol.replace("USDT", "");
                  const flash = priceFlashes.get(ticker.symbol);
                  const flashClass = flash === "up"
                    ? "bg-[#0ecb81]/15"
                    : flash === "down"
                    ? "bg-[#f6465d]/15"
                    : "";
                  return (
                    <tr
                      key={ticker.symbol}
                      className={`border-b border-border/50 hover-elevate cursor-pointer transition-colors duration-300 ${flashClass}`}
                      data-testid={`row-ticker-${ticker.symbol}`}
                      onClick={() => openTrade(ticker)}
                    >
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">{coinName}</span>
                          <span className="text-xs text-muted-foreground">/USDT</span>
                        </div>
                      </td>
                      <td className="p-3 text-right" data-testid={`text-price-${ticker.symbol}`}>
                        <span className={`font-mono transition-colors duration-300 ${
                          flash === "up" ? "text-[#0ecb81]" : flash === "down" ? "text-[#f6465d]" : "text-foreground"
                        }`}>
                          ${formatPrice(ticker.lastPrice)}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        <span className={`font-mono font-medium ${isPositive ? "text-[#0ecb81]" : "text-[#f6465d]"}`} data-testid={`text-change-${ticker.symbol}`}>
                          {isPositive ? "+" : ""}{change.toFixed(2)}%
                        </span>
                      </td>
                      <td className="p-3 text-right font-mono text-muted-foreground hidden md:table-cell">
                        ${formatPrice(ticker.highPrice)}
                      </td>
                      <td className="p-3 text-right font-mono text-muted-foreground hidden md:table-cell">
                        ${formatPrice(ticker.lowPrice)}
                      </td>
                      <td className="p-3 text-right font-mono text-muted-foreground hidden sm:table-cell">
                        ${formatVolume(ticker.quoteVolume)}
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            openTrade(ticker);
                          }}
                          data-testid={`button-trade-${ticker.symbol}`}
                        >
                          Trade
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {filteredTickers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      No coins found matching your search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          {connected ? (
            <Badge variant="outline" className="gap-1 text-[#0ecb81] border-[#0ecb81]/30 no-default-hover-elevate no-default-active-elevate" data-testid="badge-ws-status">
              <Wifi className="w-3 h-3" />
              Live - Real-time Binance Data
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 text-muted-foreground no-default-hover-elevate no-default-active-elevate" data-testid="badge-ws-status">
              <WifiOff className="w-3 h-3" />
              Connecting...
            </Badge>
          )}
        </div>
      </div>

      <TradeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        symbol={tradeSymbol}
        currentPrice={tradePrice}
      />
    </LayoutShell>
  );
}
