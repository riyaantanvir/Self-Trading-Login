import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useTickers, useWatchlist, useAddToWatchlist, useRemoveFromWatchlist } from "@/hooks/use-trades";
import { useBinanceWebSocket } from "@/hooks/use-binance-ws";
import { LayoutShell } from "@/components/layout-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Loader2, Search, ArrowUpDown, Wifi, WifiOff, MoreVertical, Star, Eye, Gauge } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface Ticker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
}

interface FngEntry {
  value: string;
  value_classification: string;
  timestamp: string;
}

function getFngColor(value: number): string {
  if (value <= 24) return "#f6465d";
  if (value <= 49) return "#f0b90b";
  if (value === 50) return "#a0a0a0";
  if (value <= 74) return "#82ca9d";
  return "#0ecb81";
}

function getFngLabel(value: number): string {
  if (value <= 24) return "Extreme Fear";
  if (value <= 49) return "Fear";
  if (value === 50) return "Neutral";
  if (value <= 74) return "Greed";
  return "Extreme Greed";
}

function FearGreedGauge({ value, label }: { value: number; label: string }) {
  const angle = (value / 100) * 180 - 90;
  const color = getFngColor(value);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-56 h-32 overflow-visible">
        <svg viewBox="0 0 200 110" className="w-full h-full">
          <defs>
            <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#f6465d" />
              <stop offset="25%" stopColor="#f0b90b" />
              <stop offset="50%" stopColor="#a0a0a0" />
              <stop offset="75%" stopColor="#82ca9d" />
              <stop offset="100%" stopColor="#0ecb81" />
            </linearGradient>
          </defs>
          <path
            d="M 20 100 A 80 80 0 0 1 180 100"
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth="12"
            strokeLinecap="round"
          />
          <path
            d="M 20 100 A 80 80 0 0 1 180 100"
            fill="none"
            stroke="url(#gaugeGrad)"
            strokeWidth="12"
            strokeLinecap="round"
            opacity="0.8"
          />
          <line
            x1="100"
            y1="100"
            x2={100 + 60 * Math.cos((angle * Math.PI) / 180)}
            y2={100 - 60 * Math.sin((-angle * Math.PI) / 180)}
            stroke={color}
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="100" cy="100" r="5" fill={color} />
          <text x="20" y="108" fontSize="8" fill="hsl(var(--muted-foreground))" textAnchor="middle">0</text>
          <text x="100" y="18" fontSize="8" fill="hsl(var(--muted-foreground))" textAnchor="middle">50</text>
          <text x="180" y="108" fontSize="8" fill="hsl(var(--muted-foreground))" textAnchor="middle">100</text>
        </svg>
      </div>
      <div className="text-center">
        <div className="text-4xl font-bold font-mono" style={{ color }} data-testid="text-fng-value">
          {value}
        </div>
        <div className="text-sm font-medium mt-1" style={{ color }} data-testid="text-fng-label">
          {label}
        </div>
      </div>
    </div>
  );
}

function FearGreedHistory({ data }: { data: FngEntry[] }) {
  if (!data || data.length === 0) return null;

  const reversed = [...data].reverse();
  const maxVal = 100;
  const barWidth = Math.max(12, Math.floor(700 / reversed.length));

  return (
    <div className="mt-6">
      <h3 className="text-sm font-medium text-muted-foreground mb-3">Last 30 Days</h3>
      <div className="overflow-x-auto">
        <div className="flex items-end gap-1" style={{ minWidth: reversed.length * (barWidth + 4) }}>
          {reversed.map((entry, i) => {
            const val = parseInt(entry.value);
            const height = Math.max(4, (val / maxVal) * 120);
            const color = getFngColor(val);
            return (
              <div key={i} className="flex flex-col items-center gap-1" style={{ width: barWidth }}>
                <div className="text-[9px] font-mono text-muted-foreground">{val}</div>
                <div
                  className="rounded-sm w-full"
                  style={{ height, backgroundColor: color, opacity: 0.8 }}
                  title={`${entry.timestamp}: ${val} (${entry.value_classification})`}
                  data-testid={`bar-fng-${i}`}
                />
                {i % 5 === 0 && (
                  <div className="text-[8px] text-muted-foreground truncate w-full text-center">
                    {entry.timestamp.split(" ").slice(0, 2).join(" ")}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex items-center justify-center gap-4 mt-4 flex-wrap">
        {[
          { label: "Extreme Fear", color: "#f6465d", range: "0-24" },
          { label: "Fear", color: "#f0b90b", range: "25-49" },
          { label: "Neutral", color: "#a0a0a0", range: "50" },
          { label: "Greed", color: "#82ca9d", range: "51-74" },
          { label: "Extreme Greed", color: "#0ecb81", range: "75-100" },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: item.color }} />
            <span>{item.label} ({item.range})</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FearGreedTab() {
  const { data, isLoading } = useQuery<{ data: FngEntry[] }>({
    queryKey: ["/api/market/fear-greed"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data?.data?.[0]) {
    return (
      <div className="text-center py-16 text-muted-foreground text-sm">
        Unable to load Fear & Greed data. Please try again later.
      </div>
    );
  }

  const current = data.data[0];
  const value = parseInt(current.value);
  const label = getFngLabel(value);

  const yesterday = data.data[1] ? parseInt(data.data[1].value) : null;
  const weekAgo = data.data[7] ? parseInt(data.data[7].value) : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row items-center gap-8">
            <FearGreedGauge value={value} label={label} />
            <div className="flex-1 space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-foreground">Crypto Fear & Greed Index</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Measures market sentiment from 0 (extreme fear) to 100 (extreme greed) based on volatility, volume, social media, and market trends.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center p-3 rounded-md bg-muted/30">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Today</div>
                  <div className="text-xl font-bold font-mono mt-1" style={{ color: getFngColor(value) }}>
                    {value}
                  </div>
                  <div className="text-[10px]" style={{ color: getFngColor(value) }}>{label}</div>
                </div>
                {yesterday !== null && (
                  <div className="text-center p-3 rounded-md bg-muted/30">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Yesterday</div>
                    <div className="text-xl font-bold font-mono mt-1" style={{ color: getFngColor(yesterday) }}>
                      {yesterday}
                    </div>
                    <div className="text-[10px]" style={{ color: getFngColor(yesterday) }}>{getFngLabel(yesterday)}</div>
                  </div>
                )}
                {weekAgo !== null && (
                  <div className="text-center p-3 rounded-md bg-muted/30">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">7 Days Ago</div>
                    <div className="text-xl font-bold font-mono mt-1" style={{ color: getFngColor(weekAgo) }}>
                      {weekAgo}
                    </div>
                    <div className="text-[10px]" style={{ color: getFngColor(weekAgo) }}>{getFngLabel(weekAgo)}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <FearGreedHistory data={data.data} />
        </CardContent>
      </Card>
    </div>
  );
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
  const [activeTab, setActiveTab] = useState<"all" | "watchlist" | "feargreed">("all");
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
          {activeTab !== "feargreed" && (
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
          )}
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
          <Button
            variant={activeTab === "feargreed" ? "secondary" : "ghost"}
            size="sm"
            className={`text-xs gap-1 toggle-elevate ${activeTab === "feargreed" ? "toggle-elevated" : ""}`}
            onClick={() => setActiveTab("feargreed")}
            data-testid="button-tab-feargreed"
          >
            <Gauge className="w-3 h-3" />
            Fear & Greed
          </Button>
        </div>

        {activeTab === "feargreed" ? (
          <FearGreedTab />
        ) : (
          <>
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
          </>
        )}
      </div>

    </LayoutShell>
  );
}
