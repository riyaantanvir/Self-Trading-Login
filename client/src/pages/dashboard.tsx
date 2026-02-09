import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useTickers, useWatchlist, useAddToWatchlist, useRemoveFromWatchlist } from "@/hooks/use-trades";
import { useBinanceWebSocket } from "@/hooks/use-binance-ws";
import { LayoutShell } from "@/components/layout-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Loader2, Search, ArrowUpDown, Wifi, WifiOff, MoreVertical, Star, Eye } from "lucide-react";

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
  const { data: watchlistData } = useWatchlist();
  const addToWatchlist = useAddToWatchlist();
  const removeFromWatchlist = useRemoveFromWatchlist();
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<"symbol" | "lastPrice" | "priceChangePercent" | "quoteVolume">("quoteVolume");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [activeTab, setActiveTab] = useState<"all" | "watchlist">("all");
  const [, navigate] = useLocation();

  const watchlistSymbols = useMemo(() => {
    if (!watchlistData) return new Set<string>();
    return new Set((watchlistData as any[]).map((w: any) => w.symbol));
  }, [watchlistData]);

  const filteredTickers = useMemo(() => {
    if (!tickers) return [];
    let list = (tickers as Ticker[]).filter((t) =>
      t.symbol.toLowerCase().includes(search.toLowerCase())
    );
    if (activeTab === "watchlist") {
      list = list.filter((t) => watchlistSymbols.has(t.symbol));
    }
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
  }, [tickers, search, sortField, sortDir, activeTab, watchlistSymbols]);

  function handleSort(field: typeof sortField) {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  function openToken(ticker: Ticker) {
    navigate(`/trade/${ticker.symbol.toLowerCase()}`);
  }

  function toggleWatchlist(symbol: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (watchlistSymbols.has(symbol)) {
      removeFromWatchlist.mutate(symbol);
    } else {
      addToWatchlist.mutate(symbol);
    }
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

        <div className="flex items-center gap-2 mb-4">
          <Button
            variant={activeTab === "all" ? "secondary" : "ghost"}
            size="sm"
            className={`text-xs toggle-elevate ${activeTab === "all" ? "toggle-elevated" : ""}`}
            onClick={() => setActiveTab("all")}
            data-testid="button-tab-all"
          >
            All Coins
          </Button>
          <Button
            variant={activeTab === "watchlist" ? "secondary" : "ghost"}
            size="sm"
            className={`text-xs gap-1 toggle-elevate ${activeTab === "watchlist" ? "toggle-elevated" : ""}`}
            onClick={() => setActiveTab("watchlist")}
            data-testid="button-tab-watchlist"
          >
            <Star className="w-3 h-3" />
            Watchlist
            {watchlistSymbols.size > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0" data-testid="badge-watchlist-count">
                {watchlistSymbols.size}
              </Badge>
            )}
          </Button>
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
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium w-12">Action</th>
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
                  const isWatched = watchlistSymbols.has(ticker.symbol);
                  return (
                    <tr
                      key={ticker.symbol}
                      className={`border-b border-border/50 hover-elevate cursor-pointer transition-colors duration-300 ${flashClass}`}
                      data-testid={`row-ticker-${ticker.symbol}`}
                      onClick={() => openToken(ticker)}
                    >
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          {isWatched && <Star className="w-3 h-3 text-yellow-500 fill-yellow-500 flex-shrink-0" />}
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
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={(e) => e.stopPropagation()}
                              data-testid={`button-actions-${ticker.symbol}`}
                            >
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                openToken(ticker);
                              }}
                              className="cursor-pointer"
                              data-testid={`menu-trade-${ticker.symbol}`}
                            >
                              <Eye className="w-4 h-4 mr-2" />
                              View {coinName}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={(e) => toggleWatchlist(ticker.symbol, e as any)}
                              className="cursor-pointer"
                              data-testid={`menu-watchlist-${ticker.symbol}`}
                            >
                              <Star className={`w-4 h-4 mr-2 ${isWatched ? "text-yellow-500 fill-yellow-500" : ""}`} />
                              {isWatched ? "Remove from Watchlist" : "Add to Watchlist"}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
                {filteredTickers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      {activeTab === "watchlist"
                        ? "Your watchlist is empty. Add coins from the All Coins tab."
                        : "No coins found matching your search."}
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

    </LayoutShell>
  );
}
