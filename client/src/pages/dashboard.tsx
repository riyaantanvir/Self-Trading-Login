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
import { Loader2, Search, ArrowUpDown, Wifi, WifiOff, MoreVertical, Star, Eye, Gauge, Newspaper, ExternalLink, Clock, TrendingUp, TrendingDown, Activity, BarChart3, Zap, ArrowUp, ArrowDown, Minus, Layers, Target, Shield, Flame, Scale } from "lucide-react";
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

interface TrendData {
  symbol: string;
  trend: "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell";
  score: number;
  ema9: number;
  ema21: number;
  ema50: number;
  price: number;
  volRatio: number;
  volumeAnomaly: boolean;
}

interface DepthLevel {
  price: number;
  quantity: number;
  total: number;
}

interface DepthData {
  symbol: string;
  currentPrice: number;
  bids: DepthLevel[];
  asks: DepthLevel[];
  bidWalls: DepthLevel[];
  askWalls: DepthLevel[];
  totalBidDepth: number;
  totalAskDepth: number;
}

interface LongShortCoin {
  symbol: string;
  longAccount: number;
  shortAccount: number;
  longShortRatio: number;
}

interface LongShortData {
  coins: LongShortCoin[];
  marketSentiment: {
    avgLong: number;
    avgShort: number;
    overallRatio: number;
    bias: "long" | "short" | "neutral";
  };
}

function MMTAnalyticsTab({ tickers }: { tickers: Ticker[] }) {
  const [, navigate] = useLocation();
  const [depthSymbol, setDepthSymbol] = useState("BTCUSDT");
  const { data: trends, isLoading: trendsLoading } = useQuery<TrendData[]>({
    queryKey: ["/api/market/trends"],
    refetchInterval: 60000,
  });

  const { data: depthData, isLoading: depthLoading } = useQuery<DepthData>({
    queryKey: ["/api/market/orderbook-depth", depthSymbol],
    queryFn: async () => {
      const res = await fetch(`/api/market/orderbook-depth?symbol=${depthSymbol}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch depth data");
      return res.json();
    },
    refetchInterval: 10000,
  });

  const { data: longShortData, isLoading: longShortLoading } = useQuery<LongShortData>({
    queryKey: ["/api/market/long-short"],
    refetchInterval: 60000,
  });

  const topGainers = useMemo(() => {
    if (!tickers || tickers.length === 0) return [];
    return [...tickers]
      .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
      .slice(0, 5);
  }, [tickers]);

  const topLosers = useMemo(() => {
    if (!tickers || tickers.length === 0) return [];
    return [...tickers]
      .sort((a, b) => parseFloat(a.priceChangePercent) - parseFloat(b.priceChangePercent))
      .slice(0, 5);
  }, [tickers]);

  const volumeLeaders = useMemo(() => {
    if (!tickers || tickers.length === 0) return [];
    return [...tickers]
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, 5);
  }, [tickers]);

  const marketStats = useMemo(() => {
    if (!tickers || tickers.length === 0) return null;
    const totalVol = tickers.reduce((s, t) => s + parseFloat(t.quoteVolume), 0);
    const btcVol = parseFloat(tickers.find(t => t.symbol === "BTCUSDT")?.quoteVolume || "0");
    const ethVol = parseFloat(tickers.find(t => t.symbol === "ETHUSDT")?.quoteVolume || "0");
    const avgChange = tickers.reduce((s, t) => s + parseFloat(t.priceChangePercent), 0) / tickers.length;
    const positive = tickers.filter(t => parseFloat(t.priceChangePercent) >= 0).length;
    const negative = tickers.length - positive;
    return {
      totalVol,
      btcDominance: totalVol > 0 ? (btcVol / totalVol * 100) : 0,
      ethDominance: totalVol > 0 ? (ethVol / totalVol * 100) : 0,
      avgChange,
      positive,
      negative,
      breadth: tickers.length > 0 ? (positive / tickers.length * 100) : 50,
    };
  }, [tickers]);

  const volumeAnomalies = useMemo(() => {
    if (!trends) return [];
    return trends.filter(t => t.volumeAnomaly).sort((a, b) => b.volRatio - a.volRatio);
  }, [trends]);

  const heatmapData = useMemo(() => {
    if (!tickers || tickers.length === 0) return [];
    const totalVol = tickers.reduce((s, t) => s + parseFloat(t.quoteVolume), 0);
    return tickers
      .map(t => ({
        symbol: t.symbol.replace("USDT", ""),
        change: parseFloat(t.priceChangePercent),
        volume: parseFloat(t.quoteVolume),
        price: t.lastPrice,
        weight: totalVol > 0 ? (parseFloat(t.quoteVolume) / totalVol) : 0,
      }))
      .sort((a, b) => b.volume - a.volume);
  }, [tickers]);

  function formatVol(v: number) {
    if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
    return `$${v.toFixed(0)}`;
  }

  function formatP(price: string) {
    const num = parseFloat(price);
    if (num >= 1000) return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (num >= 1) return num.toFixed(4);
    if (num >= 0.01) return num.toFixed(6);
    return num.toFixed(8);
  }

  function getHeatColor(change: number) {
    if (change >= 5) return "bg-[#0ecb81]";
    if (change >= 2) return "bg-[#0ecb81]/70";
    if (change >= 0) return "bg-[#0ecb81]/30";
    if (change >= -2) return "bg-[#f6465d]/30";
    if (change >= -5) return "bg-[#f6465d]/70";
    return "bg-[#f6465d]";
  }

  function getTrendBadge(trend: string) {
    switch (trend) {
      case "strong_buy":
        return <Badge className="bg-[#0ecb81] text-white text-[10px] no-default-hover-elevate no-default-active-elevate">Strong Buy</Badge>;
      case "buy":
        return <Badge className="bg-[#0ecb81]/60 text-white text-[10px] no-default-hover-elevate no-default-active-elevate">Buy</Badge>;
      case "sell":
        return <Badge className="bg-[#f6465d]/60 text-white text-[10px] no-default-hover-elevate no-default-active-elevate">Sell</Badge>;
      case "strong_sell":
        return <Badge className="bg-[#f6465d] text-white text-[10px] no-default-hover-elevate no-default-active-elevate">Strong Sell</Badge>;
      default:
        return <Badge variant="secondary" className="text-[10px] no-default-hover-elevate no-default-active-elevate">Neutral</Badge>;
    }
  }

  function getTrendIcon(trend: string) {
    switch (trend) {
      case "strong_buy":
      case "buy":
        return <ArrowUp className="w-3 h-3 text-[#0ecb81]" />;
      case "sell":
      case "strong_sell":
        return <ArrowDown className="w-3 h-3 text-[#f6465d]" />;
      default:
        return <Minus className="w-3 h-3 text-muted-foreground" />;
    }
  }

  if (!tickers || tickers.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
        Loading market data...
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="mmt-analytics-tab">
      {marketStats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Card>
            <CardContent className="p-3">
              <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                <BarChart3 className="w-3 h-3" /> Total Volume
              </div>
              <div className="text-sm font-semibold font-mono" data-testid="text-total-volume">{formatVol(marketStats.totalVol)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="text-[10px] text-muted-foreground mb-1">BTC Dominance</div>
              <div className="text-sm font-semibold font-mono" data-testid="text-btc-dominance">{marketStats.btcDominance.toFixed(1)}%</div>
              <div className="w-full h-1.5 bg-muted rounded-full mt-1.5">
                <div className="h-full bg-[#f7931a] rounded-full" style={{ width: `${Math.min(marketStats.btcDominance, 100)}%` }} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="text-[10px] text-muted-foreground mb-1">Avg 24h Change</div>
              <div className={`text-sm font-semibold font-mono ${marketStats.avgChange >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]"}`} data-testid="text-avg-change">
                {marketStats.avgChange >= 0 ? "+" : ""}{marketStats.avgChange.toFixed(2)}%
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="text-[10px] text-muted-foreground mb-1">Market Breadth</div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[#0ecb81] font-mono" data-testid="text-breadth-up">{marketStats.positive}</span>
                <div className="flex-1 h-1.5 bg-[#f6465d]/30 rounded-full overflow-hidden">
                  <div className="h-full bg-[#0ecb81] rounded-full" style={{ width: `${marketStats.breadth}%` }} />
                </div>
                <span className="text-[#f6465d] font-mono" data-testid="text-breadth-down">{marketStats.negative}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <TrendingUp className="w-3.5 h-3.5 text-[#0ecb81]" />
              <span className="text-xs font-semibold">Top Gainers</span>
            </div>
            <div className="space-y-1.5">
              {topGainers.map((t, i) => (
                <div
                  key={t.symbol}
                  className="flex items-center gap-2 text-xs cursor-pointer hover-elevate rounded-md px-2 py-1.5"
                  onClick={() => navigate(`/trade/${t.symbol.toLowerCase()}`)}
                  data-testid={`row-gainer-${t.symbol}`}
                >
                  <span className="text-muted-foreground w-4">{i + 1}</span>
                  <span className="font-semibold flex-1">{t.symbol.replace("USDT", "")}</span>
                  <span className="font-mono text-muted-foreground">${formatP(t.lastPrice)}</span>
                  <span className="font-mono text-[#0ecb81] min-w-[52px] text-right">+{parseFloat(t.priceChangePercent).toFixed(2)}%</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <TrendingDown className="w-3.5 h-3.5 text-[#f6465d]" />
              <span className="text-xs font-semibold">Top Losers</span>
            </div>
            <div className="space-y-1.5">
              {topLosers.map((t, i) => (
                <div
                  key={t.symbol}
                  className="flex items-center gap-2 text-xs cursor-pointer hover-elevate rounded-md px-2 py-1.5"
                  onClick={() => navigate(`/trade/${t.symbol.toLowerCase()}`)}
                  data-testid={`row-loser-${t.symbol}`}
                >
                  <span className="text-muted-foreground w-4">{i + 1}</span>
                  <span className="font-semibold flex-1">{t.symbol.replace("USDT", "")}</span>
                  <span className="font-mono text-muted-foreground">${formatP(t.lastPrice)}</span>
                  <span className="font-mono text-[#f6465d] min-w-[52px] text-right">{parseFloat(t.priceChangePercent).toFixed(2)}%</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="flex items-center gap-1.5 mb-3">
            <Activity className="w-3.5 h-3.5" />
            <span className="text-xs font-semibold">Market Heatmap</span>
            <span className="text-[10px] text-muted-foreground ml-auto">Size = Volume</span>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-1" data-testid="heatmap-grid">
            {heatmapData.map((coin) => {
              const minSize = 48;
              const maxSize = 96;
              const size = Math.max(minSize, Math.min(maxSize, minSize + coin.weight * 400));
              return (
                <div
                  key={coin.symbol}
                  className={`${getHeatColor(coin.change)} rounded-md flex flex-col items-center justify-center cursor-pointer transition-all`}
                  style={{ minHeight: `${size}px` }}
                  onClick={() => navigate(`/trade/${coin.symbol.toLowerCase()}usdt`)}
                  data-testid={`heatmap-cell-${coin.symbol}`}
                >
                  <span className="text-xs font-bold text-white drop-shadow-sm">{coin.symbol}</span>
                  <span className={`text-[10px] font-mono font-semibold ${coin.change >= 0 ? "text-white" : "text-white"}`}>
                    {coin.change >= 0 ? "+" : ""}{coin.change.toFixed(2)}%
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <BarChart3 className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-xs font-semibold">Volume Leaders</span>
            </div>
            <div className="space-y-1.5">
              {volumeLeaders.map((t, i) => {
                const maxVol = parseFloat(volumeLeaders[0]?.quoteVolume || "1");
                const vol = parseFloat(t.quoteVolume);
                const pct = maxVol > 0 ? (vol / maxVol) * 100 : 0;
                return (
                  <div
                    key={t.symbol}
                    className="relative cursor-pointer hover-elevate rounded-md px-2 py-1.5"
                    onClick={() => navigate(`/trade/${t.symbol.toLowerCase()}`)}
                    data-testid={`row-volume-${t.symbol}`}
                  >
                    <div className="absolute inset-0 bg-blue-500/10 rounded-md" style={{ width: `${pct}%` }} />
                    <div className="flex items-center gap-2 text-xs relative z-10">
                      <span className="text-muted-foreground w-4">{i + 1}</span>
                      <span className="font-semibold flex-1">{t.symbol.replace("USDT", "")}</span>
                      <span className="font-mono text-muted-foreground">{formatVol(vol)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {volumeAnomalies.length > 0 && (
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Zap className="w-3.5 h-3.5 text-yellow-400" />
                <span className="text-xs font-semibold">Volume Anomalies</span>
              </div>
              <div className="space-y-1.5">
                {volumeAnomalies.slice(0, 5).map((t) => (
                  <div
                    key={t.symbol}
                    className="flex items-center gap-2 text-xs cursor-pointer hover-elevate rounded-md px-2 py-1.5"
                    onClick={() => navigate(`/trade/${t.symbol.toLowerCase()}`)}
                    data-testid={`row-anomaly-${t.symbol}`}
                  >
                    <Zap className="w-3 h-3 text-yellow-400 flex-shrink-0" />
                    <span className="font-semibold flex-1">{t.symbol.replace("USDT", "")}</span>
                    <span className="font-mono text-yellow-400">{t.volRatio}x avg</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="flex items-center gap-1.5 mb-3">
            <Activity className="w-3.5 h-3.5 text-purple-400" />
            <span className="text-xs font-semibold">Trend Meter</span>
            <span className="text-[10px] text-muted-foreground ml-auto">EMA 9/21/50 (1H)</span>
          </div>
          {trendsLoading ? (
            <div className="py-6 text-center text-muted-foreground text-xs">
              <Loader2 className="w-4 h-4 animate-spin mx-auto mb-1" />
              Analyzing trends...
            </div>
          ) : trends && trends.length > 0 ? (
            <div className="space-y-1">
              <div className="grid grid-cols-[1fr_60px_60px_60px_70px] gap-1 text-[10px] text-muted-foreground px-2 mb-1">
                <span>Coin</span>
                <span className="text-right">EMA 9</span>
                <span className="text-right">EMA 21</span>
                <span className="text-right">Price</span>
                <span className="text-right">Signal</span>
              </div>
              {trends.map((t) => {
                const coin = t.symbol.replace("USDT", "");
                const ticker = tickers.find((tk: Ticker) => tk.symbol === t.symbol);
                const livePrice = ticker ? parseFloat(ticker.lastPrice) : t.price;
                return (
                  <div
                    key={t.symbol}
                    className="grid grid-cols-[1fr_60px_60px_60px_70px] gap-1 items-center text-xs cursor-pointer hover-elevate rounded-md px-2 py-1.5"
                    onClick={() => navigate(`/trade/${t.symbol.toLowerCase()}`)}
                    data-testid={`row-trend-${t.symbol}`}
                  >
                    <div className="flex items-center gap-1.5">
                      {getTrendIcon(t.trend)}
                      <span className="font-semibold">{coin}</span>
                    </div>
                    <span className="font-mono text-[11px] text-muted-foreground text-right">{t.ema9 >= 100 ? t.ema9.toFixed(1) : t.ema9.toFixed(4)}</span>
                    <span className="font-mono text-[11px] text-muted-foreground text-right">{t.ema21 >= 100 ? t.ema21.toFixed(1) : t.ema21.toFixed(4)}</span>
                    <span className={`font-mono text-[11px] text-right ${livePrice > t.ema9 ? "text-[#0ecb81]" : livePrice < t.ema21 ? "text-[#f6465d]" : "text-foreground"}`}>
                      {livePrice >= 100 ? livePrice.toFixed(1) : livePrice.toFixed(4)}
                    </span>
                    <div className="flex justify-end">{getTrendBadge(t.trend)}</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-6 text-center text-muted-foreground text-xs">No trend data available</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3">
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-xs font-semibold">Order Book Depth & Liquidity</span>
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              {["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"].map((sym) => (
                <Button
                  key={sym}
                  size="sm"
                  variant={depthSymbol === sym ? "default" : "ghost"}
                  className="text-[10px]"
                  onClick={() => setDepthSymbol(sym)}
                  data-testid={`button-depth-${sym}`}
                >
                  {sym.replace("USDT", "")}
                </Button>
              ))}
            </div>
          </div>
          {depthLoading ? (
            <div className="py-6 text-center text-muted-foreground text-xs">
              <Loader2 className="w-4 h-4 animate-spin mx-auto mb-1" />
              Loading order book...
            </div>
          ) : depthData ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs mb-2">
                <div>
                  <span className="text-muted-foreground">Bid Depth: </span>
                  <span className="font-mono text-[#0ecb81] font-semibold">{formatVol(depthData.totalBidDepth)}</span>
                </div>
                <div className="text-center">
                  <span className="text-muted-foreground">Price: </span>
                  <span className="font-mono font-semibold">${depthData.currentPrice >= 1 ? depthData.currentPrice.toLocaleString(undefined, { maximumFractionDigits: 2 }) : depthData.currentPrice.toFixed(6)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Ask Depth: </span>
                  <span className="font-mono text-[#f6465d] font-semibold">{formatVol(depthData.totalAskDepth)}</span>
                </div>
              </div>

              <div className="relative h-32 flex items-end gap-[1px] rounded-md overflow-hidden" data-testid="depth-chart">
                {(() => {
                  const allLevels = [...depthData.bids.slice().reverse(), ...depthData.asks];
                  const maxQtyUsd = Math.max(...allLevels.map(l => l.quantity * l.price), 1);
                  return allLevels.map((level, i) => {
                    const isBid = i < depthData.bids.length;
                    const usdVal = level.quantity * level.price;
                    const heightPct = Math.max((usdVal / maxQtyUsd) * 100, 2);
                    const isWall = usdVal > 50000;
                    return (
                      <div
                        key={i}
                        className={`flex-1 rounded-t-sm transition-all ${isBid ? (isWall ? "bg-[#0ecb81]" : "bg-[#0ecb81]/40") : (isWall ? "bg-[#f6465d]" : "bg-[#f6465d]/40")}`}
                        style={{ height: `${heightPct}%` }}
                        title={`$${level.price.toLocaleString()} - ${formatVol(usdVal)}`}
                      />
                    );
                  });
                })()}
              </div>

              <div className="flex justify-between text-[10px] text-muted-foreground px-1">
                <span>Bids (Support)</span>
                <span>
                  Ratio: <span className={`font-mono font-semibold ${depthData.totalBidDepth > depthData.totalAskDepth ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>
                    {(depthData.totalBidDepth / Math.max(depthData.totalAskDepth, 1)).toFixed(2)}
                  </span>
                </span>
                <span>Asks (Resistance)</span>
              </div>

              {(depthData.bidWalls.length > 0 || depthData.askWalls.length > 0) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                  {depthData.bidWalls.length > 0 && (
                    <div>
                      <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                        <Shield className="w-3 h-3 text-[#0ecb81]" /> Bid Walls (Support)
                      </div>
                      <div className="space-y-0.5">
                        {depthData.bidWalls.map((w, i) => (
                          <div key={i} className="flex items-center gap-2 text-[11px] font-mono px-1.5 py-0.5 rounded-sm bg-[#0ecb81]/10">
                            <span className="text-[#0ecb81]">${w.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                            <span className="text-muted-foreground ml-auto">{formatVol(w.quantity * w.price)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {depthData.askWalls.length > 0 && (
                    <div>
                      <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                        <Shield className="w-3 h-3 text-[#f6465d]" /> Ask Walls (Resistance)
                      </div>
                      <div className="space-y-0.5">
                        {depthData.askWalls.map((w, i) => (
                          <div key={i} className="flex items-center gap-2 text-[11px] font-mono px-1.5 py-0.5 rounded-sm bg-[#f6465d]/10">
                            <span className="text-[#f6465d]">${w.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                            <span className="text-muted-foreground ml-auto">{formatVol(w.quantity * w.price)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="py-6 text-center text-muted-foreground text-xs">No depth data available</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3">
          <div className="flex items-center gap-1.5 mb-3">
            <Target className="w-3.5 h-3.5 text-orange-400" />
            <span className="text-xs font-semibold">Liquidation Map</span>
            <span className="text-[10px] text-muted-foreground ml-auto">Estimated levels by leverage</span>
          </div>
          {tickers.length > 0 ? (
            <div className="space-y-3">
              {(() => {
                const leverages = [2, 3, 5, 10, 25, 50, 100];
                const topCoins = tickers
                  .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
                  .slice(0, 6);

                return (
                  <>
                    <div className="overflow-x-auto">
                      <div className="min-w-[500px]">
                        <div className="grid grid-cols-[80px_repeat(7,1fr)] gap-1 text-[10px] text-muted-foreground px-1 mb-1">
                          <span>Coin</span>
                          {leverages.map(l => <span key={l} className="text-center">{l}x</span>)}
                        </div>
                        {topCoins.map((t) => {
                          const price = parseFloat(t.lastPrice);
                          const coin = t.symbol.replace("USDT", "");
                          return (
                            <div key={t.symbol} className="grid grid-cols-[80px_repeat(7,1fr)] gap-1 items-center text-[11px] hover-elevate rounded-md px-1 py-1 cursor-pointer" onClick={() => navigate(`/trade/${t.symbol.toLowerCase()}`)} data-testid={`row-liq-${t.symbol}`}>
                              <span className="font-semibold text-xs">{coin}</span>
                              {leverages.map(lev => {
                                const liqLong = price * (1 - 1 / lev);
                                const liqShort = price * (1 + 1 / lev);
                                const longPct = ((price - liqLong) / price * 100).toFixed(0);
                                return (
                                  <div key={lev} className="text-center">
                                    <div className="font-mono text-[#f6465d] text-[10px]" title={`Long liquidation at $${liqLong.toFixed(2)}`}>
                                      {price >= 100 ? `$${liqLong.toFixed(0)}` : `$${liqLong.toFixed(4)}`}
                                    </div>
                                    <div className="font-mono text-[#0ecb81] text-[9px]" title={`Short liquidation at $${liqShort.toFixed(2)}`}>
                                      {price >= 100 ? `$${liqShort.toFixed(0)}` : `$${liqShort.toFixed(4)}`}
                                    </div>
                                    <div className="text-[8px] text-muted-foreground">-{longPct}%</div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-[10px] text-muted-foreground px-1">
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-sm bg-[#f6465d]" />
                        <span>Long Liquidation (support breaks)</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-sm bg-[#0ecb81]" />
                        <span>Short Liquidation (squeeze levels)</span>
                      </div>
                    </div>

                    <div className="mt-2">
                      <div className="text-[10px] text-muted-foreground mb-1.5 flex items-center gap-1">
                        <Flame className="w-3 h-3 text-orange-400" /> Price Range Visualization
                      </div>
                      <div className="space-y-1">
                        {topCoins.slice(0, 4).map((t) => {
                          const price = parseFloat(t.lastPrice);
                          const coin = t.symbol.replace("USDT", "");
                          const liq10Long = price * 0.9;
                          const liq10Short = price * 1.1;
                          const liq25Long = price * 0.96;
                          const liq25Short = price * 1.04;
                          return (
                            <div key={t.symbol} className="relative h-5 bg-muted/30 rounded-sm overflow-hidden" data-testid={`liq-zone-${t.symbol}`}>
                              <div className="absolute left-0 top-0 h-full bg-[#f6465d]/20 rounded-sm" style={{ width: "10%", left: "0%" }} />
                              <div className="absolute right-0 top-0 h-full bg-[#0ecb81]/20 rounded-sm" style={{ width: "10%" }} />
                              <div className="absolute top-0 h-full w-px bg-foreground/50" style={{ left: "50%" }} />
                              <div className="absolute top-0 bottom-0 flex items-center text-[9px] font-mono" style={{ left: "50%", transform: "translateX(-50%)" }}>
                                <span className="bg-background/80 px-1 rounded-sm">{coin} ${price >= 100 ? price.toFixed(0) : price.toFixed(4)}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          ) : (
            <div className="py-6 text-center text-muted-foreground text-xs">No market data available</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3">
          <div className="flex items-center gap-1.5 mb-3">
            <Scale className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-xs font-semibold">Net Long/Short Sentiment</span>
            <span className="text-[10px] text-muted-foreground ml-auto">Order Book Pressure</span>
          </div>
          {longShortLoading ? (
            <div className="py-6 text-center text-muted-foreground text-xs">
              <Loader2 className="w-4 h-4 animate-spin mx-auto mb-1" />
              Loading sentiment...
            </div>
          ) : longShortData ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                    <span>Longs</span>
                    <span>Shorts</span>
                  </div>
                  <div className="flex h-6 rounded-md overflow-hidden">
                    <div
                      className="bg-[#0ecb81] flex items-center justify-center text-[11px] font-semibold text-white transition-all"
                      style={{ width: `${longShortData.marketSentiment.avgLong * 100}%` }}
                      data-testid="bar-long"
                    >
                      {(longShortData.marketSentiment.avgLong * 100).toFixed(1)}%
                    </div>
                    <div
                      className="bg-[#f6465d] flex items-center justify-center text-[11px] font-semibold text-white transition-all"
                      style={{ width: `${longShortData.marketSentiment.avgShort * 100}%` }}
                      data-testid="bar-short"
                    >
                      {(longShortData.marketSentiment.avgShort * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div className="text-center mt-1">
                    <Badge
                      className={`text-[10px] no-default-hover-elevate no-default-active-elevate ${longShortData.marketSentiment.bias === "long" ? "bg-[#0ecb81] text-white" : longShortData.marketSentiment.bias === "short" ? "bg-[#f6465d] text-white" : ""}`}
                    >
                      Market Bias: {longShortData.marketSentiment.bias.toUpperCase()} (Ratio: {longShortData.marketSentiment.overallRatio.toFixed(2)})
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="grid grid-cols-[1fr_80px_80px_60px] gap-1 text-[10px] text-muted-foreground px-2 mb-1">
                  <span>Coin</span>
                  <span className="text-right">Long %</span>
                  <span className="text-right">Short %</span>
                  <span className="text-right">Ratio</span>
                </div>
                {longShortData.coins.map((coin) => {
                  const longPct = coin.longAccount * 100;
                  const shortPct = coin.shortAccount * 100;
                  const sym = coin.symbol.replace("USDT", "");
                  return (
                    <div
                      key={coin.symbol}
                      className="grid grid-cols-[1fr_80px_80px_60px] gap-1 items-center text-xs cursor-pointer hover-elevate rounded-md px-2 py-1.5"
                      onClick={() => navigate(`/trade/${coin.symbol.toLowerCase()}`)}
                      data-testid={`row-ls-${coin.symbol}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{sym}</span>
                        <div className="flex-1 h-1.5 rounded-full overflow-hidden flex">
                          <div className="bg-[#0ecb81] h-full" style={{ width: `${longPct}%` }} />
                          <div className="bg-[#f6465d] h-full" style={{ width: `${shortPct}%` }} />
                        </div>
                      </div>
                      <span className="font-mono text-[11px] text-[#0ecb81] text-right">{longPct.toFixed(1)}%</span>
                      <span className="font-mono text-[11px] text-[#f6465d] text-right">{shortPct.toFixed(1)}%</span>
                      <span className={`font-mono text-[11px] text-right ${coin.longShortRatio > 1 ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>
                        {coin.longShortRatio.toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="py-6 text-center text-muted-foreground text-xs">No sentiment data available</div>
          )}
        </CardContent>
      </Card>
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
                  Measures market sentiment from 0 (extreme fear) to 100 (extreme greed) based on volatility, momentum, social media, dominance, and trends.
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Data source: Alternative.me | Updated daily
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

interface NewsArticle {
  id: string;
  title: string;
  body: string;
  url: string;
  imageUrl: string;
  source: string;
  publishedAt: number;
  categories: string;
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000 - timestamp);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function NewsTab() {
  const { data: articles, isLoading } = useQuery<NewsArticle[]>({
    queryKey: ["/api/market/news"],
    refetchInterval: 3 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!articles || articles.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground text-sm">
        No news available at the moment. Please try again later.
      </div>
    );
  }

  const featured = articles[0];
  const rest = articles.slice(1);

  return (
    <div className="space-y-4">
      <a
        href={featured.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block"
        data-testid="link-featured-news"
      >
        <Card className="overflow-hidden hover-elevate">
          <div className="flex flex-col md:flex-row">
            {featured.imageUrl && (
              <div className="md:w-80 h-48 md:h-auto shrink-0 overflow-hidden">
                <img
                  src={featured.imageUrl}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              </div>
            )}
            <CardContent className="p-4 flex flex-col justify-between flex-1">
              <div>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <Badge variant="secondary" className="text-[10px]" data-testid="badge-featured-source">{featured.source}</Badge>
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatTimeAgo(featured.publishedAt)}
                  </span>
                </div>
                <h3 className="text-base font-semibold text-foreground leading-tight mb-2" data-testid="text-featured-title">
                  {featured.title}
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
                  {featured.body}
                </p>
              </div>
              <div className="flex items-center gap-1 mt-3 text-xs text-muted-foreground">
                Read more <ExternalLink className="w-3 h-3" />
              </div>
            </CardContent>
          </div>
        </Card>
      </a>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {rest.map((article) => (
          <a
            key={article.id}
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`link-news-${article.id}`}
          >
            <Card className="h-full hover-elevate">
              <div className="flex h-full">
                {article.imageUrl && (
                  <div className="w-24 shrink-0 overflow-hidden rounded-l-md">
                    <img
                      src={article.imageUrl}
                      alt=""
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  </div>
                )}
                <CardContent className="p-3 flex flex-col justify-between flex-1 min-w-0">
                  <div>
                    <h4 className="text-xs font-medium text-foreground leading-tight line-clamp-2 mb-1.5" data-testid={`text-news-title-${article.id}`}>
                      {article.title}
                    </h4>
                    <p className="text-[10px] text-muted-foreground line-clamp-2 leading-relaxed">
                      {article.body}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="text-[10px] text-muted-foreground">{article.source}</span>
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" />
                      {formatTimeAgo(article.publishedAt)}
                    </span>
                  </div>
                </CardContent>
              </div>
            </Card>
          </a>
        ))}
      </div>
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
  const [activeTab, setActiveTab] = useState<"all" | "watchlist" | "feargreed" | "news" | "mmt">("all");
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
          {(activeTab === "all" || activeTab === "watchlist") && (
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

        <div className="flex items-center gap-1 sm:gap-2 mb-4 overflow-x-auto">
          {[
            { key: "all" as const, label: "All", icon: null },
            { key: "watchlist" as const, label: "Watchlist", icon: Star },
            { key: "feargreed" as const, label: "F&G", icon: Gauge },
            { key: "news" as const, label: "News", icon: Newspaper },
            { key: "mmt" as const, label: "MMT", icon: Activity },
          ].map((tab) => (
            <Button
              key={tab.key}
              variant={activeTab === tab.key ? "secondary" : "ghost"}
              size="sm"
              className={`text-xs gap-1 whitespace-nowrap toggle-elevate ${activeTab === tab.key ? "toggle-elevated" : ""}`}
              onClick={() => setActiveTab(tab.key)}
              data-testid={`button-tab-${tab.key}`}
            >
              {tab.icon && <tab.icon className="w-3 h-3" />}
              {tab.label}
              {tab.key === "watchlist" && watchlistSymbols.size > 0 && (
                <Badge variant="secondary" className="ml-0.5 text-[10px] px-1.5 py-0" data-testid="badge-watchlist-count">
                  {watchlistSymbols.size}
                </Badge>
              )}
            </Button>
          ))}
        </div>

        {activeTab === "mmt" ? (
          <MMTAnalyticsTab tickers={tickers as Ticker[] || []} />
        ) : activeTab === "feargreed" ? (
          <FearGreedTab />
        ) : activeTab === "news" ? (
          <NewsTab />
        ) : (
          <>
            <div className="flex items-center gap-3 mb-3 text-[10px] sm:text-xs text-muted-foreground">
              <button onClick={() => handleSort("symbol")} className="flex items-center gap-1" data-testid="button-sort-pair">
                Name <ArrowUpDown className="w-3 h-3" />
              </button>
              <button onClick={() => handleSort("lastPrice")} className="flex items-center gap-1" data-testid="button-sort-price">
                Price <ArrowUpDown className="w-3 h-3" />
              </button>
              <button onClick={() => handleSort("priceChangePercent")} className="flex items-center gap-1" data-testid="button-sort-change">
                24h% <ArrowUpDown className="w-3 h-3" />
              </button>
              <button onClick={() => handleSort("quoteVolume")} className="flex items-center gap-1" data-testid="button-sort-volume">
                Vol <ArrowUpDown className="w-3 h-3" />
              </button>
              <div className="ml-auto">
                {connected ? (
                  <span className="flex items-center gap-1 text-[#0ecb81]" data-testid="badge-ws-status">
                    <Wifi className="w-3 h-3" /> Live
                  </span>
                ) : (
                  <span className="flex items-center gap-1" data-testid="badge-ws-status">
                    <WifiOff className="w-3 h-3" /> ...
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-1">
              {filteredTickers.map((ticker) => {
                const change = parseFloat(ticker.priceChangePercent);
                const isPositive = change >= 0;
                const coinName = ticker.symbol.replace("USDT", "");
                const flash = priceFlashes.get(ticker.symbol);
                const isWatched = watchlistSymbols.has(ticker.symbol);
                return (
                  <div
                    key={ticker.symbol}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-md hover-elevate cursor-pointer transition-colors duration-300 ${
                      flash === "up" ? "bg-[#0ecb81]/8" : flash === "down" ? "bg-[#f6465d]/8" : ""
                    }`}
                    data-testid={`row-ticker-${ticker.symbol}`}
                    onClick={() => openToken(ticker)}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {isWatched && <Star className="w-3 h-3 text-yellow-500 fill-yellow-500 flex-shrink-0" />}
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-foreground">{coinName}<span className="text-muted-foreground font-normal text-xs">/USDT</span></div>
                        <div className="text-[10px] text-muted-foreground font-mono">Vol ${formatVolume(ticker.quoteVolume)}</div>
                      </div>
                    </div>

                    <div className="text-right flex-shrink-0">
                      <div className={`font-mono text-sm transition-colors duration-300 ${
                        flash === "up" ? "text-[#0ecb81]" : flash === "down" ? "text-[#f6465d]" : "text-foreground"
                      }`} data-testid={`text-price-${ticker.symbol}`}>
                        ${formatPrice(ticker.lastPrice)}
                      </div>
                    </div>

                    <div className={`text-right flex-shrink-0 min-w-[72px] px-2 py-1 rounded-md text-xs font-mono font-semibold ${
                      isPositive ? "bg-[#0ecb81]/15 text-[#0ecb81]" : "bg-[#f6465d]/15 text-[#f6465d]"
                    }`} data-testid={`text-change-${ticker.symbol}`}>
                      {isPositive ? "+" : ""}{change.toFixed(2)}%
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={(e) => e.stopPropagation()}
                          className="flex-shrink-0 hidden sm:flex"
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
                  </div>
                );
              })}
              {filteredTickers.length === 0 && (
                <div className="py-12 text-center text-muted-foreground text-sm">
                  {activeTab === "watchlist"
                    ? "Your watchlist is empty. Add coins from the All Coins tab."
                    : "No coins found matching your search."}
                </div>
              )}
            </div>
          </>
        )}
      </div>

    </LayoutShell>
  );
}
