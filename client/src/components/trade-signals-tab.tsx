import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, TrendingUp, TrendingDown, Minus, Target, Shield, Zap, BarChart3, Activity, Eye, ArrowUp, ArrowDown, Crosshair, Grid3x3, GitBranch, Layers, BarChart2, Gauge, ArrowLeftRight } from "lucide-react";
import { Input } from "@/components/ui/input";

interface Ticker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
}

interface ScannerItem {
  symbol: string;
  price: number;
  priceChange24h: number;
  volume24h: number;
  rsi: number;
  ema9: number;
  ema21: number;
  ema50: number;
  macdLine: number;
  volRatio: number;
  volatility: number;
  signal: "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell";
  signalScore: number;
  flags: {
    oversold: boolean;
    overbought: boolean;
    volumeSpike: boolean;
    emaCrossUp: boolean;
    emaCrossDown: boolean;
  };
}

interface SRData {
  symbol: string;
  currentPrice: number;
  supports: { price: number; strength: number; type: string; touches: number; strengthPct: number }[];
  resistances: { price: number; strength: number; type: string; touches: number; strengthPct: number }[];
}

interface CorrelationData {
  symbols: string[];
  matrix: { sym1: string; sym2: string; correlation: number }[];
}

interface LongShortData {
  coins: { symbol: string; longAccount: number; shortAccount: number; ratio: number; bias: string }[];
  marketSentiment: { avgLong: number; avgShort: number; overallRatio: number; bias: string };
}

type Section = "scanner" | "sr" | "signals" | "correlation" | "whale" | "pulse" | "divergence" | "mtf" | "volprofile" | "momentum" | "orderflow";

const sections: { key: Section; label: string; icon: any }[] = [
  { key: "scanner", label: "Scanner", icon: Search },
  { key: "divergence", label: "Divergence", icon: GitBranch },
  { key: "mtf", label: "Multi-TF", icon: Layers },
  { key: "volprofile", label: "Vol Profile", icon: BarChart2 },
  { key: "momentum", label: "Momentum", icon: Gauge },
  { key: "orderflow", label: "Order Flow", icon: ArrowLeftRight },
  { key: "sr", label: "S/R Levels", icon: Target },
  { key: "signals", label: "Signals", icon: Zap },
  { key: "correlation", label: "Correlation", icon: Grid3x3 },
  { key: "whale", label: "Whale Watch", icon: Eye },
  { key: "pulse", label: "Market Pulse", icon: Activity },
];

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
}

function formatVolume(vol: number): string {
  if (vol >= 1e9) return (vol / 1e9).toFixed(2) + "B";
  if (vol >= 1e6) return (vol / 1e6).toFixed(2) + "M";
  if (vol >= 1e3) return (vol / 1e3).toFixed(1) + "K";
  return vol.toFixed(0);
}

function signalColor(signal: string): string {
  switch (signal) {
    case "strong_buy": return "text-emerald-400";
    case "buy": return "text-green-400";
    case "sell": return "text-red-400";
    case "strong_sell": return "text-red-500";
    default: return "text-muted-foreground";
  }
}

function signalLabel(signal: string): string {
  switch (signal) {
    case "strong_buy": return "Strong Buy";
    case "buy": return "Buy";
    case "sell": return "Sell";
    case "strong_sell": return "Strong Sell";
    default: return "Neutral";
  }
}

function signalBadgeVariant(signal: string): "default" | "secondary" | "destructive" | "outline" {
  if (signal.includes("buy")) return "default";
  if (signal.includes("sell")) return "destructive";
  return "secondary";
}

// --- Scanner Section ---
function ScannerSection({ tickers }: { tickers: Ticker[] }) {
  const [filter, setFilter] = useState<"all" | "buy" | "sell" | "oversold" | "overbought" | "volume">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [, navigate] = useLocation();

  const { data: scannerData, isLoading } = useQuery<ScannerItem[]>({
    queryKey: ["/api/market/scanner"],
    refetchInterval: 30000,
  });

  const filtered = (scannerData || []).filter(item => {
    if (searchTerm && !item.symbol.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    switch (filter) {
      case "buy": return item.signal === "buy" || item.signal === "strong_buy";
      case "sell": return item.signal === "sell" || item.signal === "strong_sell";
      case "oversold": return item.flags.oversold;
      case "overbought": return item.flags.overbought;
      case "volume": return item.flags.volumeSpike;
      default: return true;
    }
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-3" data-testid="scanner-section">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[150px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <Input
            placeholder="Search coin..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-7 h-8 text-xs"
            data-testid="input-scanner-search"
          />
        </div>
        {(["all", "buy", "sell", "oversold", "overbought", "volume"] as const).map(f => (
          <Button
            key={f}
            variant={filter === f ? "secondary" : "ghost"}
            size="sm"
            className="text-xs"
            onClick={() => setFilter(f)}
            data-testid={`button-filter-${f}`}
          >
            {f === "all" ? "All" : f === "buy" ? "Buy Signals" : f === "sell" ? "Sell Signals" : f === "oversold" ? "Oversold" : f === "overbought" ? "Overbought" : "Vol Spike"}
          </Button>
        ))}
      </div>

      <div className="space-y-1">
        <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-2 px-3 py-1 text-[10px] text-muted-foreground">
          <span>Coin</span>
          <span className="text-right w-16">Price</span>
          <span className="text-right w-12">RSI</span>
          <span className="text-right w-14">Vol Ratio</span>
          <span className="text-right w-14">24h %</span>
          <span className="text-right w-20">Signal</span>
        </div>
        {filtered.map(item => (
          <Card
            key={item.symbol}
            className="hover-elevate cursor-pointer"
            onClick={() => navigate(`/trade/${item.symbol}`)}
            data-testid={`card-scanner-${item.symbol}`}
          >
            <CardContent className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-2 items-center p-3">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm" data-testid={`text-scanner-symbol-${item.symbol}`}>{item.symbol.replace("USDT", "")}</span>
                <div className="flex gap-0.5">
                  {item.flags.oversold && <Badge variant="outline" className="text-[9px] px-1 py-0 text-green-400 border-green-400/30">Oversold</Badge>}
                  {item.flags.overbought && <Badge variant="outline" className="text-[9px] px-1 py-0 text-red-400 border-red-400/30">Overbought</Badge>}
                  {item.flags.volumeSpike && <Badge variant="outline" className="text-[9px] px-1 py-0 text-yellow-400 border-yellow-400/30">Vol</Badge>}
                  {item.flags.emaCrossUp && <Badge variant="outline" className="text-[9px] px-1 py-0 text-emerald-400 border-emerald-400/30">Cross Up</Badge>}
                  {item.flags.emaCrossDown && <Badge variant="outline" className="text-[9px] px-1 py-0 text-red-400 border-red-400/30">Cross Down</Badge>}
                </div>
              </div>
              <span className="text-right text-sm font-mono w-16" data-testid={`text-scanner-price-${item.symbol}`}>{formatPrice(item.price)}</span>
              <span className={`text-right text-xs font-mono w-12 ${item.rsi < 30 ? "text-green-400" : item.rsi > 70 ? "text-red-400" : "text-muted-foreground"}`} data-testid={`text-scanner-rsi-${item.symbol}`}>
                {item.rsi}
              </span>
              <span className={`text-right text-xs font-mono w-14 ${item.volRatio > 2 ? "text-yellow-400" : "text-muted-foreground"}`} data-testid={`text-scanner-vol-${item.symbol}`}>
                {item.volRatio}x
              </span>
              <span className={`text-right text-xs font-mono w-14 ${item.priceChange24h >= 0 ? "text-green-400" : "text-red-400"}`} data-testid={`text-scanner-change-${item.symbol}`}>
                {item.priceChange24h >= 0 ? "+" : ""}{item.priceChange24h.toFixed(2)}%
              </span>
              <div className="text-right w-20">
                <Badge variant={signalBadgeVariant(item.signal)} className="text-[10px]" data-testid={`badge-scanner-signal-${item.symbol}`}>
                  {signalLabel(item.signal)}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-8">No coins match the selected filter</p>
        )}
      </div>
    </div>
  );
}

// --- Support & Resistance Section ---
function SupportResistanceSection() {
  const [selectedSymbol, setSelectedSymbol] = useState("BTCUSDT");
  const topSymbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT"];

  const { data: srData, isLoading } = useQuery<SRData>({
    queryKey: ["/api/market/support-resistance", selectedSymbol],
    refetchInterval: 60000,
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-3" data-testid="sr-section">
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {topSymbols.map(sym => (
          <Button
            key={sym}
            variant={selectedSymbol === sym ? "secondary" : "ghost"}
            size="sm"
            className="text-xs whitespace-nowrap"
            onClick={() => setSelectedSymbol(sym)}
            data-testid={`button-sr-${sym}`}
          >
            {sym.replace("USDT", "")}
          </Button>
        ))}
      </div>

      {srData && (
        <div className="space-y-4">
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Current Price</p>
            <p className="text-lg font-mono font-medium" data-testid="text-sr-current-price">{formatPrice(srData.currentPrice)}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card data-testid="card-resistance-levels">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <ArrowUp className="w-4 h-4 text-red-400" />
                  <span className="text-sm font-medium">Resistance Levels</span>
                </div>
                {srData.resistances.length > 0 ? srData.resistances.map((level, i) => (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm text-red-400" data-testid={`text-resistance-${i}`}>{formatPrice(level.price)}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">{level.touches} touches</span>
                        <Badge variant="outline" className="text-[9px]">{level.strengthPct}%</Badge>
                      </div>
                    </div>
                    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-red-400/60 rounded-full" style={{ width: `${level.strengthPct}%` }} />
                    </div>
                  </div>
                )) : <p className="text-xs text-muted-foreground">No resistance levels detected</p>}
              </CardContent>
            </Card>

            <Card data-testid="card-support-levels">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <ArrowDown className="w-4 h-4 text-green-400" />
                  <span className="text-sm font-medium">Support Levels</span>
                </div>
                {srData.supports.length > 0 ? srData.supports.map((level, i) => (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm text-green-400" data-testid={`text-support-${i}`}>{formatPrice(level.price)}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">{level.touches} touches</span>
                        <Badge variant="outline" className="text-[9px]">{level.strengthPct}%</Badge>
                      </div>
                    </div>
                    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-green-400/60 rounded-full" style={{ width: `${level.strengthPct}%` }} />
                    </div>
                  </div>
                )) : <p className="text-xs text-muted-foreground">No support levels detected</p>}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-2">How to use S/R levels</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="flex items-start gap-2">
                  <Shield className="w-3 h-3 text-green-400 mt-0.5 shrink-0" />
                  <span><strong>Support:</strong> Price tends to bounce up here. Consider buying near support with a stop below.</span>
                </div>
                <div className="flex items-start gap-2">
                  <Target className="w-3 h-3 text-red-400 mt-0.5 shrink-0" />
                  <span><strong>Resistance:</strong> Price tends to pull back here. Consider taking profit or selling near resistance.</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// --- Buy/Sell Signals Section ---
function SignalsSection() {
  const { data: scannerData, isLoading } = useQuery<ScannerItem[]>({
    queryKey: ["/api/market/scanner"],
    refetchInterval: 30000,
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const items = scannerData || [];
  const buySignals = items.filter(i => i.signal === "buy" || i.signal === "strong_buy");
  const sellSignals = items.filter(i => i.signal === "sell" || i.signal === "strong_sell");
  const neutrals = items.filter(i => i.signal === "neutral");

  return (
    <div className="space-y-4" data-testid="signals-section">
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-green-400" data-testid="text-buy-count">{buySignals.length}</p>
            <p className="text-xs text-muted-foreground">Buy Signals</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-muted-foreground" data-testid="text-neutral-count">{neutrals.length}</p>
            <p className="text-xs text-muted-foreground">Neutral</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-red-400" data-testid="text-sell-count">{sellSignals.length}</p>
            <p className="text-xs text-muted-foreground">Sell Signals</p>
          </CardContent>
        </Card>
      </div>

      {buySignals.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium flex items-center gap-2"><TrendingUp className="w-4 h-4 text-green-400" /> Buy Opportunities</h3>
          {buySignals.map(item => (
            <SignalCard key={item.symbol} item={item} />
          ))}
        </div>
      )}

      {sellSignals.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium flex items-center gap-2"><TrendingDown className="w-4 h-4 text-red-400" /> Sell Signals</h3>
          {sellSignals.map(item => (
            <SignalCard key={item.symbol} item={item} />
          ))}
        </div>
      )}

      {neutrals.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium flex items-center gap-2"><Minus className="w-4 h-4 text-muted-foreground" /> Neutral / Wait</h3>
          {neutrals.map(item => (
            <SignalCard key={item.symbol} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function SignalCard({ item }: { item: ScannerItem }) {
  const [, navigate] = useLocation();

  const reasons: string[] = [];
  if (item.rsi < 30) reasons.push("RSI oversold (" + item.rsi + ")");
  else if (item.rsi < 40) reasons.push("RSI near oversold (" + item.rsi + ")");
  else if (item.rsi > 70) reasons.push("RSI overbought (" + item.rsi + ")");
  else if (item.rsi > 60) reasons.push("RSI near overbought (" + item.rsi + ")");

  if (item.ema9 > item.ema21) reasons.push("EMA 9 above 21 (bullish)");
  else reasons.push("EMA 9 below 21 (bearish)");

  if (item.price > item.ema50) reasons.push("Price above EMA 50");
  else reasons.push("Price below EMA 50");

  if (item.flags.volumeSpike) reasons.push("Volume spike (" + item.volRatio + "x avg)");
  if (item.flags.emaCrossUp) reasons.push("EMA crossover up");
  if (item.flags.emaCrossDown) reasons.push("EMA crossover down");

  const strength = Math.abs(item.signalScore);
  const strengthLabel = strength >= 4 ? "Strong" : strength >= 2 ? "Medium" : "Weak";

  return (
    <Card className="hover-elevate cursor-pointer" onClick={() => navigate(`/trade/${item.symbol}`)} data-testid={`card-signal-${item.symbol}`}>
      <CardContent className="p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{item.symbol.replace("USDT", "")}</span>
            <span className="font-mono text-xs text-muted-foreground">{formatPrice(item.price)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[9px]">{strengthLabel}</Badge>
            <Badge variant={signalBadgeVariant(item.signal)} className="text-[10px]" data-testid={`badge-signal-${item.symbol}`}>
              {signalLabel(item.signal)}
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {reasons.map((r, i) => (
            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{r}</span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// --- Correlation Map Section ---
function CorrelationSection() {
  const { data: corrData, isLoading } = useQuery<CorrelationData>({
    queryKey: ["/api/market/correlation"],
    refetchInterval: 120000,
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  if (!corrData) return null;

  const { symbols, matrix } = corrData;

  function getCorrelation(s1: string, s2: string): number {
    const entry = matrix.find(m => (m.sym1 === s1 && m.sym2 === s2) || (m.sym1 === s2 && m.sym2 === s1));
    return entry?.correlation ?? 0;
  }

  function corrColor(v: number): string {
    if (v >= 0.8) return "bg-emerald-500/80 text-white";
    if (v >= 0.5) return "bg-emerald-500/40";
    if (v >= 0.2) return "bg-emerald-500/20";
    if (v >= -0.2) return "bg-muted";
    if (v >= -0.5) return "bg-red-500/20";
    if (v >= -0.8) return "bg-red-500/40";
    return "bg-red-500/80 text-white";
  }

  const displaySymbols = symbols.map(s => s.replace("USDT", ""));

  return (
    <div className="space-y-3" data-testid="correlation-section">
      <p className="text-xs text-muted-foreground">72-hour price correlation between top coins. High correlation means they move together. Low/negative means they move independently or opposite.</p>

      <div className="overflow-x-auto">
        <div className="inline-block min-w-full">
          <div className="grid gap-0.5" style={{ gridTemplateColumns: `60px repeat(${symbols.length}, 48px)` }}>
            <div />
            {displaySymbols.map(s => (
              <div key={s} className="text-[9px] text-center text-muted-foreground font-mono py-1 truncate">{s}</div>
            ))}
            {symbols.map((sym1, i) => (
              <div key={sym1} className="contents">
                <div className="text-[9px] text-right text-muted-foreground font-mono pr-2 flex items-center justify-end">{displaySymbols[i]}</div>
                {symbols.map((sym2, j) => {
                  const corr = getCorrelation(sym1, sym2);
                  return (
                    <div
                      key={`${sym1}-${sym2}`}
                      className={`text-[9px] text-center py-1.5 rounded-sm font-mono ${corrColor(corr)}`}
                      title={`${displaySymbols[i]} vs ${displaySymbols[j]}: ${corr.toFixed(2)}`}
                      data-testid={`cell-corr-${i}-${j}`}
                    >
                      {corr.toFixed(2)}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="p-3">
          <p className="text-xs text-muted-foreground mb-2">How to use correlation</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div className="flex items-start gap-2">
              <div className="w-3 h-3 rounded-sm bg-emerald-500/60 shrink-0 mt-0.5" />
              <span><strong>High (0.5+):</strong> Move together. Avoid buying both — you're doubling your risk on the same move.</span>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-3 h-3 rounded-sm bg-red-500/40 shrink-0 mt-0.5" />
              <span><strong>Low/Negative:</strong> Move independently. Good for diversification. One may rise while the other falls.</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// --- Whale Watch Section ---
interface WhaleItem {
  symbol: string;
  totalBidDepth: number;
  totalAskDepth: number;
  ratio: number;
  biggestBidWall: { price: number; quantity: number } | null;
  biggestAskWall: { price: number; quantity: number } | null;
}

function WhaleWatchSection() {
  const { data: rawWhaleData, isLoading } = useQuery<WhaleItem[]>({
    queryKey: ["/api/market/whale-watch"],
    refetchInterval: 15000,
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const whaleData = (rawWhaleData || []).map(item => ({
    symbol: item.symbol,
    bidTotal: item.totalBidDepth,
    askTotal: item.totalAskDepth,
    ratio: item.ratio,
    bias: item.ratio > 1.2 ? "bullish" as const : item.ratio < 0.8 ? "bearish" as const : "neutral" as const,
    biggestBidWall: item.biggestBidWall,
    biggestAskWall: item.biggestAskWall,
    imbalance: (item.ratio - 1) * 100,
  })).sort((a, b) => Math.abs(b.imbalance) - Math.abs(a.imbalance));

  return (
    <div className="space-y-3" data-testid="whale-section">
      <p className="text-xs text-muted-foreground">Large orders detected in the order book. Big buy walls suggest whales are accumulating (bullish). Big sell walls suggest distribution (bearish).</p>

      <div className="space-y-2">
        {whaleData.map(item => (
          <Card key={item.symbol} data-testid={`card-whale-${item.symbol}`}>
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm">{item.symbol.replace("USDT", "")}</span>
                <Badge
                  variant={item.bias === "bullish" ? "default" : item.bias === "bearish" ? "destructive" : "secondary"}
                  className="text-[10px]"
                  data-testid={`badge-whale-bias-${item.symbol}`}
                >
                  {item.bias === "bullish" ? "Buy Pressure" : item.bias === "bearish" ? "Sell Pressure" : "Balanced"}
                </Badge>
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                    <span>Bids (Buyers)</span>
                    <span className="font-mono text-green-400">{formatVolume(item.bidTotal)}</span>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-400/60 rounded-full transition-all"
                      style={{ width: `${(item.ratio / (item.ratio + 1)) * 100}%` }}
                    />
                  </div>
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                    <span>Asks (Sellers)</span>
                    <span className="font-mono text-red-400">{formatVolume(item.askTotal)}</span>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-red-400/60 rounded-full transition-all"
                      style={{ width: `${(1 / (item.ratio + 1)) * 100}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4 text-[10px]">
                {item.biggestBidWall && (
                  <span className="text-muted-foreground">
                    Buy wall: <span className="font-mono text-green-400">{formatVolume(item.biggestBidWall.quantity)}</span> @ {formatPrice(item.biggestBidWall.price)}
                  </span>
                )}
                {item.biggestAskWall && (
                  <span className="text-muted-foreground">
                    Sell wall: <span className="font-mono text-red-400">{formatVolume(item.biggestAskWall.quantity)}</span> @ {formatPrice(item.biggestAskWall.price)}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// --- Market Pulse Section ---
function MarketPulseSection({ tickers }: { tickers: Ticker[] }) {
  const { data: fngData } = useQuery<{ data: { value: string; value_classification: string }[] }>({
    queryKey: ["/api/market/fear-greed"],
    refetchInterval: 300000,
  });

  const { data: longShortData } = useQuery<LongShortData>({
    queryKey: ["/api/market/long-short"],
    refetchInterval: 30000,
  });

  const greenCount = tickers.filter(t => parseFloat(t.priceChangePercent) > 0).length;
  const redCount = tickers.filter(t => parseFloat(t.priceChangePercent) < 0).length;
  const totalCount = tickers.length;
  const greenPct = totalCount > 0 ? (greenCount / totalCount * 100) : 0;
  const avgChange = totalCount > 0 ? tickers.reduce((s, t) => s + parseFloat(t.priceChangePercent), 0) / totalCount : 0;
  const totalVolume = tickers.reduce((s, t) => s + parseFloat(t.quoteVolume || "0"), 0);

  const topGainers = [...tickers].sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent)).slice(0, 3);
  const topLosers = [...tickers].sort((a, b) => parseFloat(a.priceChangePercent) - parseFloat(b.priceChangePercent)).slice(0, 3);

  const fng = fngData?.data?.[0];
  const fngValue = fng ? parseInt(fng.value) : null;
  const sentiment = longShortData?.marketSentiment;

  let marketCondition = "Neutral";
  let conditionColor = "text-muted-foreground";
  if (greenPct > 70 && avgChange > 2) { marketCondition = "Strong Bullish"; conditionColor = "text-emerald-400"; }
  else if (greenPct > 55 && avgChange > 0.5) { marketCondition = "Bullish"; conditionColor = "text-green-400"; }
  else if (greenPct < 30 && avgChange < -2) { marketCondition = "Strong Bearish"; conditionColor = "text-red-500"; }
  else if (greenPct < 45 && avgChange < -0.5) { marketCondition = "Bearish"; conditionColor = "text-red-400"; }

  return (
    <div className="space-y-4" data-testid="pulse-section">
      <Card>
        <CardContent className="p-4 text-center">
          <p className="text-xs text-muted-foreground mb-1">Market Condition</p>
          <p className={`text-xl font-bold ${conditionColor}`} data-testid="text-market-condition">{marketCondition}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {greenCount} green / {redCount} red ({greenPct.toFixed(0)}% bullish)
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">Avg 24h Change</p>
            <p className={`text-lg font-bold font-mono ${avgChange >= 0 ? "text-green-400" : "text-red-400"}`} data-testid="text-avg-change">
              {avgChange >= 0 ? "+" : ""}{avgChange.toFixed(2)}%
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">Total Volume</p>
            <p className="text-lg font-bold font-mono" data-testid="text-total-volume">{formatVolume(totalVolume)}</p>
          </CardContent>
        </Card>
        {fngValue !== null && (
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Fear & Greed</p>
              <p className={`text-lg font-bold font-mono ${fngValue < 25 ? "text-red-400" : fngValue < 50 ? "text-orange-400" : fngValue < 75 ? "text-yellow-400" : "text-green-400"}`} data-testid="text-fng-value">
                {fngValue}
              </p>
              <p className="text-[10px] text-muted-foreground">{fng?.value_classification}</p>
            </CardContent>
          </Card>
        )}
        {sentiment && (
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Sentiment Bias</p>
              <p className={`text-lg font-bold ${sentiment.bias === "long" ? "text-green-400" : sentiment.bias === "short" ? "text-red-400" : "text-muted-foreground"}`} data-testid="text-sentiment-bias">
                {sentiment.bias === "long" ? "Bullish" : sentiment.bias === "short" ? "Bearish" : "Neutral"}
              </p>
              <p className="text-[10px] text-muted-foreground">L/S Ratio: {sentiment.overallRatio.toFixed(2)}</p>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-3">
            <h4 className="text-sm font-medium flex items-center gap-2 mb-2"><TrendingUp className="w-3 h-3 text-green-400" />Top Gainers</h4>
            {topGainers.map(t => (
              <div key={t.symbol} className="flex items-center justify-between py-1 text-xs">
                <span className="font-medium">{t.symbol.replace("USDT", "")}</span>
                <span className="font-mono text-green-400" data-testid={`text-gainer-${t.symbol}`}>+{parseFloat(t.priceChangePercent).toFixed(2)}%</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <h4 className="text-sm font-medium flex items-center gap-2 mb-2"><TrendingDown className="w-3 h-3 text-red-400" />Top Losers</h4>
            {topLosers.map(t => (
              <div key={t.symbol} className="flex items-center justify-between py-1 text-xs">
                <span className="font-medium">{t.symbol.replace("USDT", "")}</span>
                <span className="font-mono text-red-400" data-testid={`text-loser-${t.symbol}`}>{parseFloat(t.priceChangePercent).toFixed(2)}%</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-3">
          <p className="text-xs text-muted-foreground mb-2">Market breadth</p>
          <div className="w-full h-3 bg-muted rounded-full overflow-hidden flex">
            <div className="h-full bg-green-400/70 transition-all" style={{ width: `${greenPct}%` }} data-testid="bar-green-pct" />
            <div className="h-full bg-red-400/70 transition-all" style={{ width: `${100 - greenPct}%` }} />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>{greenCount} coins up ({greenPct.toFixed(0)}%)</span>
            <span>{redCount} coins down ({(100 - greenPct).toFixed(0)}%)</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// --- Divergence Detector Section ---
interface DivergenceItem {
  symbol: string;
  price: number;
  priceChange24h: number;
  rsi: number;
  macdHistogram: number;
  divergences: { type: string; indicator: string; description: string; strength: string; barsAgo: number }[];
  hasBullish: boolean;
  hasBearish: boolean;
}

function DivergenceSection() {
  const [filter, setFilter] = useState<"all" | "bullish" | "bearish">("all");
  const [, navigate] = useLocation();

  const { data: divData, isLoading } = useQuery<DivergenceItem[]>({
    queryKey: ["/api/market/divergence"],
    refetchInterval: 30000,
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const items = (divData || []).filter(item => {
    if (filter === "bullish") return item.hasBullish;
    if (filter === "bearish") return item.hasBearish;
    return item.divergences.length > 0;
  });

  const withDivergences = items.filter(i => i.divergences.length > 0);
  const noDivergences = (divData || []).filter(i => i.divergences.length === 0);

  return (
    <div className="space-y-3" data-testid="divergence-section">
      <p className="text-xs text-muted-foreground">Detects when price and indicators move in opposite directions — a strong reversal signal. Bullish divergence = potential bounce up. Bearish divergence = potential drop.</p>

      <div className="flex items-center gap-2 flex-wrap">
        {(["all", "bullish", "bearish"] as const).map(f => (
          <Button
            key={f}
            variant={filter === f ? "secondary" : "ghost"}
            size="sm"
            className="text-xs"
            onClick={() => setFilter(f)}
            data-testid={`button-div-filter-${f}`}
          >
            {f === "all" ? "All Active" : f === "bullish" ? "Bullish Only" : "Bearish Only"}
          </Button>
        ))}
        <span className="text-[10px] text-muted-foreground ml-auto">
          {withDivergences.length} coins with divergences detected
        </span>
      </div>

      {withDivergences.length === 0 && filter === "all" && (
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-sm text-muted-foreground">No divergences detected right now. This is normal — divergences are uncommon and appear when reversals may be forming.</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {withDivergences.map(item => (
          <Card key={item.symbol} className="hover-elevate cursor-pointer" onClick={() => navigate(`/trade/${item.symbol}`)} data-testid={`card-div-${item.symbol}`}>
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{item.symbol.replace("USDT", "")}</span>
                  <span className="font-mono text-xs text-muted-foreground">${formatPrice(item.price)}</span>
                  <span className={`text-xs font-mono ${item.priceChange24h >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {item.priceChange24h >= 0 ? "+" : ""}{item.priceChange24h.toFixed(2)}%
                  </span>
                </div>
                <div className="flex gap-1">
                  {item.hasBullish && <Badge variant="default" className="text-[9px]">Bullish Div</Badge>}
                  {item.hasBearish && <Badge variant="destructive" className="text-[9px]">Bearish Div</Badge>}
                </div>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span>RSI: <span className={`font-mono ${item.rsi < 30 ? "text-green-400" : item.rsi > 70 ? "text-red-400" : ""}`}>{item.rsi}</span></span>
                <span>MACD Hist: <span className={`font-mono ${item.macdHistogram > 0 ? "text-green-400" : "text-red-400"}`}>{item.macdHistogram.toFixed(4)}</span></span>
              </div>
              <div className="space-y-1">
                {item.divergences.map((d, i) => (
                  <div key={i} className="flex items-center gap-2 text-[10px]">
                    {d.type === "bullish" ? <ArrowUp className="w-3 h-3 text-green-400 shrink-0" /> : <ArrowDown className="w-3 h-3 text-red-400 shrink-0" />}
                    <span className={d.type === "bullish" ? "text-green-400" : "text-red-400"}>{d.indicator}</span>
                    <span className="text-muted-foreground">{d.description}</span>
                    <Badge variant="outline" className="text-[8px] px-1 py-0 ml-auto">{d.strength} | {d.barsAgo}h ago</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filter === "all" && noDivergences.length > 0 && (
        <div className="pt-2">
          <p className="text-[10px] text-muted-foreground mb-1">No divergences: {noDivergences.map(i => i.symbol.replace("USDT", "")).join(", ")}</p>
        </div>
      )}
    </div>
  );
}

// --- Multi-Timeframe Section ---
interface MTFItem {
  symbol: string;
  price: number;
  timeframes: Record<string, { rsi: number; ema9: number; ema21: number; macd: number; trend: string; score: number; price: number } | null>;
  alignment: string;
  bullishCount: number;
  bearishCount: number;
  totalTimeframes: number;
}

function MultiTimeframeSection() {
  const [, navigate] = useLocation();

  const { data: mtfData, isLoading } = useQuery<MTFItem[]>({
    queryKey: ["/api/market/multi-timeframe"],
    refetchInterval: 30000,
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const items = mtfData || [];
  const tfLabels = ["5m", "15m", "1H", "4H", "1D"];

  function trendIcon(trend: string | undefined) {
    if (trend === "bullish") return <ArrowUp className="w-3 h-3 text-green-400" />;
    if (trend === "bearish") return <ArrowDown className="w-3 h-3 text-red-400" />;
    return <Minus className="w-3 h-3 text-muted-foreground" />;
  }

  function trendBg(trend: string | undefined) {
    if (trend === "bullish") return "bg-green-500/15";
    if (trend === "bearish") return "bg-red-500/15";
    return "bg-muted";
  }

  function alignmentBadge(alignment: string) {
    switch (alignment) {
      case "strong_bullish": return <Badge variant="default" className="text-[9px]">All Bullish</Badge>;
      case "bullish": return <Badge variant="default" className="text-[9px]">Mostly Bullish</Badge>;
      case "strong_bearish": return <Badge variant="destructive" className="text-[9px]">All Bearish</Badge>;
      case "bearish": return <Badge variant="destructive" className="text-[9px]">Mostly Bearish</Badge>;
      default: return <Badge variant="secondary" className="text-[9px]">Mixed</Badge>;
    }
  }

  return (
    <div className="space-y-3" data-testid="mtf-section">
      <p className="text-xs text-muted-foreground">When all timeframes agree (all green or all red), it's a high-confidence signal. Mixed signals mean wait for alignment before entering.</p>

      <div className="space-y-2">
        {items.map(item => (
          <Card key={item.symbol} className="hover-elevate cursor-pointer" onClick={() => navigate(`/trade/${item.symbol}`)} data-testid={`card-mtf-${item.symbol}`}>
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{item.symbol.replace("USDT", "")}</span>
                  <span className="font-mono text-xs text-muted-foreground">${formatPrice(item.price)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">{item.bullishCount}/{item.totalTimeframes} bullish</span>
                  {alignmentBadge(item.alignment)}
                </div>
              </div>

              <div className="grid grid-cols-5 gap-1">
                {tfLabels.map(tf => {
                  const tfData = item.timeframes[tf];
                  return (
                    <div key={tf} className={`rounded-md p-1.5 text-center ${trendBg(tfData?.trend)}`} data-testid={`cell-mtf-${item.symbol}-${tf}`}>
                      <div className="flex items-center justify-center gap-0.5 mb-0.5">
                        {trendIcon(tfData?.trend)}
                        <span className="text-[10px] font-medium">{tf}</span>
                      </div>
                      {tfData ? (
                        <div className="space-y-0.5">
                          <span className={`block text-[9px] font-mono ${tfData.rsi < 30 ? "text-green-400" : tfData.rsi > 70 ? "text-red-400" : "text-muted-foreground"}`}>
                            RSI {tfData.rsi}
                          </span>
                          <span className={`block text-[9px] font-mono ${tfData.macd > 0 ? "text-green-400" : "text-red-400"}`}>
                            MACD {tfData.macd > 0 ? "+" : ""}{tfData.macd > 1 ? tfData.macd.toFixed(2) : tfData.macd.toFixed(6)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[9px] text-muted-foreground">N/A</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-3">
          <p className="text-xs text-muted-foreground mb-2">How to read Multi-TF</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div className="flex items-start gap-2">
              <ArrowUp className="w-3 h-3 text-green-400 mt-0.5 shrink-0" />
              <span><strong>All Green:</strong> All timeframes bullish — strongest buy signal. Enter with confidence.</span>
            </div>
            <div className="flex items-start gap-2">
              <ArrowDown className="w-3 h-3 text-red-400 mt-0.5 shrink-0" />
              <span><strong>All Red:</strong> All timeframes bearish — strongest sell signal. Avoid buying.</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// --- Volume Profile Section ---
interface VolumeProfileData {
  symbol: string;
  currentPrice: number;
  vwap: number;
  poc: number;
  valueAreaHigh: number;
  valueAreaLow: number;
  volumeAtPrice: { priceLevel: number; volume: number; buyVolume: number; sellVolume: number }[];
  priceVsVwap: string;
}

function VolumeProfileSection() {
  const [selectedSymbol, setSelectedSymbol] = useState("BTCUSDT");
  const topSymbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT"];

  const { data: vpData, isLoading } = useQuery<VolumeProfileData>({
    queryKey: ["/api/market/volume-profile", selectedSymbol],
    refetchInterval: 30000,
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const maxVol = vpData ? Math.max(...vpData.volumeAtPrice.map(v => v.volume)) : 1;

  return (
    <div className="space-y-3" data-testid="volprofile-section">
      <p className="text-xs text-muted-foreground">Shows where the most volume was traded. VWAP = average fair price. POC = price with highest volume. Price tends to gravitate toward these levels.</p>

      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {topSymbols.map(sym => (
          <Button
            key={sym}
            variant={selectedSymbol === sym ? "secondary" : "ghost"}
            size="sm"
            className="text-xs whitespace-nowrap"
            onClick={() => setSelectedSymbol(sym)}
            data-testid={`button-vp-${sym}`}
          >
            {sym.replace("USDT", "")}
          </Button>
        ))}
      </div>

      {vpData && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-[10px] text-muted-foreground">Current Price</p>
                <p className="text-sm font-mono font-medium" data-testid="text-vp-price">${formatPrice(vpData.currentPrice)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-[10px] text-muted-foreground">VWAP (Fair Price)</p>
                <p className={`text-sm font-mono font-medium ${vpData.priceVsVwap === "above" ? "text-green-400" : "text-red-400"}`} data-testid="text-vp-vwap">
                  ${formatPrice(vpData.vwap)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-[10px] text-muted-foreground">POC (Max Volume)</p>
                <p className="text-sm font-mono font-medium text-yellow-400" data-testid="text-vp-poc">${formatPrice(vpData.poc)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-[10px] text-muted-foreground">Value Area</p>
                <p className="text-xs font-mono" data-testid="text-vp-va">
                  <span className="text-green-400">{formatPrice(vpData.valueAreaLow)}</span>
                  <span className="text-muted-foreground"> - </span>
                  <span className="text-red-400">{formatPrice(vpData.valueAreaHigh)}</span>
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground mb-2">Volume at Price (200H)</p>
              <div className="space-y-0.5">
                {vpData.volumeAtPrice.slice().reverse().map((level, i) => {
                  const isCurrentZone = Math.abs(level.priceLevel - vpData.currentPrice) / vpData.currentPrice < 0.005;
                  const isPOC = Math.abs(level.priceLevel - vpData.poc) / vpData.poc < 0.005;
                  const isVWAP = Math.abs(level.priceLevel - vpData.vwap) / vpData.vwap < 0.005;
                  const buyPct = level.volume > 0 ? (level.buyVolume / level.volume) * 100 : 50;
                  const barWidth = maxVol > 0 ? (level.volume / maxVol) * 100 : 0;

                  return (
                    <div key={i} className={`flex items-center gap-2 py-0.5 rounded-sm px-1 ${isCurrentZone ? "bg-blue-500/10" : ""}`} data-testid={`row-vp-${i}`}>
                      <span className={`text-[9px] font-mono w-20 text-right shrink-0 ${isPOC ? "text-yellow-400 font-bold" : isVWAP ? "text-blue-400" : "text-muted-foreground"}`}>
                        {formatPrice(level.priceLevel)}
                        {isPOC ? " POC" : isVWAP ? " VWAP" : ""}
                      </span>
                      <div className="flex-1 h-3 flex rounded-sm overflow-hidden bg-muted/30">
                        <div className="h-full bg-green-400/50" style={{ width: `${barWidth * (buyPct / 100)}%` }} />
                        <div className="h-full bg-red-400/50" style={{ width: `${barWidth * ((100 - buyPct) / 100)}%` }} />
                      </div>
                      <span className="text-[8px] font-mono text-muted-foreground w-14 text-right shrink-0">{formatVolume(level.volume)}</span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground mb-2">How to use Volume Profile</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="flex items-start gap-2">
                  <div className="w-3 h-3 rounded-sm bg-yellow-400/60 shrink-0 mt-0.5" />
                  <span><strong>POC:</strong> Most traded price. Acts as a magnet — price often returns here.</span>
                </div>
                <div className="flex items-start gap-2">
                  <div className="w-3 h-3 rounded-sm bg-blue-400/60 shrink-0 mt-0.5" />
                  <span><strong>VWAP:</strong> Fair price. Buy below VWAP for value, sell above for profit.</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// --- Momentum Heatmap Section ---
interface MomentumItem {
  symbol: string;
  price: number;
  priceChange24h: number;
  rsi: number;
  mom1h: number;
  mom4h: number;
  mom12h: number;
  mom24h: number;
  volRatio: number;
  momentumScore: number;
  strength: string;
}

function MomentumSection() {
  const [, navigate] = useLocation();

  const { data: momData, isLoading } = useQuery<MomentumItem[]>({
    queryKey: ["/api/market/momentum"],
    refetchInterval: 15000,
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const items = momData || [];

  function strengthColor(strength: string) {
    switch (strength) {
      case "strong_up": return "text-emerald-400";
      case "up": return "text-green-400";
      case "down": return "text-red-400";
      case "strong_down": return "text-red-500";
      default: return "text-muted-foreground";
    }
  }

  function strengthLabel(strength: string) {
    switch (strength) {
      case "strong_up": return "Strong Up";
      case "up": return "Gaining";
      case "down": return "Losing";
      case "strong_down": return "Strong Down";
      default: return "Flat";
    }
  }

  function momentumBg(value: number) {
    if (value > 1) return "bg-green-500/30 text-green-400";
    if (value > 0) return "bg-green-500/10 text-green-400";
    if (value < -1) return "bg-red-500/30 text-red-400";
    if (value < 0) return "bg-red-500/10 text-red-400";
    return "bg-muted text-muted-foreground";
  }

  return (
    <div className="space-y-3" data-testid="momentum-section">
      <p className="text-xs text-muted-foreground">Real-time momentum across multiple periods. Green = gaining strength, Red = losing. Sorted by strongest momentum first.</p>

      <div className="overflow-x-auto">
        <div className="space-y-1 min-w-[500px]">
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto_auto] gap-2 px-3 py-1 text-[9px] text-muted-foreground">
            <span>Coin</span>
            <span className="text-right w-12">1H</span>
            <span className="text-right w-12">4H</span>
            <span className="text-right w-12">12H</span>
            <span className="text-right w-12">24H</span>
            <span className="text-right w-10">RSI</span>
            <span className="text-right w-10">Vol</span>
            <span className="text-right w-16">Strength</span>
          </div>

          {items.map(item => (
            <Card key={item.symbol} className="hover-elevate cursor-pointer" onClick={() => navigate(`/trade/${item.symbol}`)} data-testid={`card-mom-${item.symbol}`}>
              <CardContent className="grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto_auto] gap-2 items-center p-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{item.symbol.replace("USDT", "")}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{formatPrice(item.price)}</span>
                </div>
                {[item.mom1h, item.mom4h, item.mom12h, item.mom24h].map((mom, i) => (
                  <div key={i} className={`text-right w-12 text-[10px] font-mono rounded-sm px-1 py-0.5 ${momentumBg(mom)}`}>
                    {mom >= 0 ? "+" : ""}{mom.toFixed(2)}%
                  </div>
                ))}
                <span className={`text-right w-10 text-[10px] font-mono ${item.rsi < 30 ? "text-green-400" : item.rsi > 70 ? "text-red-400" : "text-muted-foreground"}`}>
                  {item.rsi}
                </span>
                <span className={`text-right w-10 text-[10px] font-mono ${item.volRatio > 2 ? "text-yellow-400" : "text-muted-foreground"}`}>
                  {item.volRatio}x
                </span>
                <div className="text-right w-16">
                  <span className={`text-[10px] font-medium ${strengthColor(item.strength)}`}>
                    {strengthLabel(item.strength)}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Order Flow Section ---
interface OrderFlowItem {
  symbol: string;
  price: number;
  totalBidUsd: number;
  totalAskUsd: number;
  bidPct: number;
  askPct: number;
  imbalance: number;
  nearImbalance: number;
  pressure: string;
}

function OrderFlowSection() {
  const { data: flowData, isLoading } = useQuery<OrderFlowItem[]>({
    queryKey: ["/api/market/orderflow"],
    refetchInterval: 10000,
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const items = flowData || [];

  function pressureBadge(pressure: string) {
    switch (pressure) {
      case "strong_buy": return <Badge variant="default" className="text-[9px]">Strong Buy</Badge>;
      case "buy": return <Badge variant="default" className="text-[9px]">Buy Pressure</Badge>;
      case "strong_sell": return <Badge variant="destructive" className="text-[9px]">Strong Sell</Badge>;
      case "sell": return <Badge variant="destructive" className="text-[9px]">Sell Pressure</Badge>;
      default: return <Badge variant="secondary" className="text-[9px]">Balanced</Badge>;
    }
  }

  return (
    <div className="space-y-3" data-testid="orderflow-section">
      <p className="text-xs text-muted-foreground">Real-time bid vs ask volume from the order book. When buyers dominate (green bar wider), price tends to go up. When sellers dominate, price tends to drop.</p>

      <div className="space-y-2">
        {items.map(item => (
          <Card key={item.symbol} data-testid={`card-flow-${item.symbol}`}>
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{item.symbol.replace("USDT", "")}</span>
                  <span className="font-mono text-xs text-muted-foreground">${formatPrice(item.price)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-mono ${item.imbalance > 0 ? "text-green-400" : "text-red-400"}`}>
                    {item.imbalance > 0 ? "+" : ""}{item.imbalance.toFixed(1)}%
                  </span>
                  {pressureBadge(item.pressure)}
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="w-8">Bids</span>
                  <div className="flex-1 h-4 bg-muted rounded-sm overflow-hidden flex">
                    <div className="h-full bg-green-400/60 flex items-center justify-end pr-1 transition-all" style={{ width: `${item.bidPct}%` }}>
                      <span className="text-[8px] font-mono text-white">{item.bidPct.toFixed(0)}%</span>
                    </div>
                    <div className="h-full bg-red-400/60 flex items-center pl-1 transition-all" style={{ width: `${item.askPct}%` }}>
                      <span className="text-[8px] font-mono text-white">{item.askPct.toFixed(0)}%</span>
                    </div>
                  </div>
                  <span className="w-8 text-right">Asks</span>
                </div>

                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-muted-foreground">
                    Bid: <span className="font-mono text-green-400">${formatVolume(item.totalBidUsd)}</span>
                  </span>
                  <span className="text-muted-foreground">
                    Near: <span className={`font-mono ${item.nearImbalance > 0 ? "text-green-400" : "text-red-400"}`}>
                      {item.nearImbalance > 0 ? "+" : ""}{item.nearImbalance.toFixed(1)}%
                    </span>
                  </span>
                  <span className="text-muted-foreground">
                    Ask: <span className="font-mono text-red-400">${formatVolume(item.totalAskUsd)}</span>
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-3">
          <p className="text-xs text-muted-foreground mb-2">How to read Order Flow</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div className="flex items-start gap-2">
              <div className="w-3 h-3 rounded-sm bg-green-400/60 shrink-0 mt-0.5" />
              <span><strong>Buy Pressure:</strong> More bids than asks. Buyers want in — bullish short-term.</span>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-3 h-3 rounded-sm bg-red-400/60 shrink-0 mt-0.5" />
              <span><strong>Sell Pressure:</strong> More asks than bids. Sellers want out — bearish short-term.</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// --- Main Trade Signals Tab ---
export function TradeSignalsTab({ tickers }: { tickers: Ticker[] }) {
  const [section, setSection] = useState<Section>("scanner");

  return (
    <div className="space-y-4" data-testid="trade-signals-tab">
      <div className="flex items-center gap-1 overflow-x-auto pb-1" data-testid="signals-sub-nav">
        {sections.map((sec) => (
          <Button
            key={sec.key}
            variant={section === sec.key ? "secondary" : "ghost"}
            size="sm"
            className="text-xs gap-1 whitespace-nowrap"
            onClick={() => setSection(sec.key)}
            data-testid={`button-signals-${sec.key}`}
          >
            <sec.icon className="w-3 h-3" />
            {sec.label}
          </Button>
        ))}
      </div>

      {section === "scanner" && <ScannerSection tickers={tickers} />}
      {section === "divergence" && <DivergenceSection />}
      {section === "mtf" && <MultiTimeframeSection />}
      {section === "volprofile" && <VolumeProfileSection />}
      {section === "momentum" && <MomentumSection />}
      {section === "orderflow" && <OrderFlowSection />}
      {section === "sr" && <SupportResistanceSection />}
      {section === "signals" && <SignalsSection />}
      {section === "correlation" && <CorrelationSection />}
      {section === "whale" && <WhaleWatchSection />}
      {section === "pulse" && <MarketPulseSection tickers={tickers} />}
    </div>
  );
}