import { useQuery } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Loader2, TrendingUp, TrendingDown, Minus, ArrowUp, ArrowDown, ShieldCheck, AlertTriangle, Target, BarChart3, Activity, Users } from "lucide-react";

interface QuickAnalysisProps {
  symbol: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatPrice(price: number) {
  if (price >= 1000) return "$" + price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return "$" + price.toFixed(4);
  return "$" + price.toFixed(8);
}

function VerdictBanner({ verdict }: { verdict: { text: string; type: string } }) {
  const colors: Record<string, string> = {
    buy: "bg-[#0ecb81]/15 border-[#0ecb81]/30 text-[#0ecb81]",
    sell: "bg-[#f6465d]/15 border-[#f6465d]/30 text-[#f6465d]",
    hold: "bg-[#f0b90b]/15 border-[#f0b90b]/30 text-[#f0b90b]",
    caution: "bg-orange-500/15 border-orange-500/30 text-orange-400",
  };
  const icons: Record<string, any> = {
    buy: TrendingUp,
    sell: TrendingDown,
    hold: Minus,
    caution: AlertTriangle,
  };
  const labels: Record<string, string> = {
    buy: "BUY SIGNAL",
    sell: "SELL SIGNAL",
    hold: "HOLD / WAIT",
    caution: "CAUTION",
  };
  const color = colors[verdict.type] || colors.hold;
  const Icon = icons[verdict.type] || Minus;
  const label = labels[verdict.type] || "NEUTRAL";

  return (
    <div className={`p-3 rounded-md border ${color}`} data-testid="section-verdict">
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="w-5 h-5" />
        <span className="font-bold text-sm">{label}</span>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{verdict.text}</p>
    </div>
  );
}

function ZoneSection({ zones, currentPrice }: { zones: any; currentPrice: number }) {
  const zoneLabels: Record<string, { label: string; color: string }> = {
    at_support: { label: "At Support", color: "text-[#0ecb81]" },
    near_support: { label: "Near Support", color: "text-[#0ecb81]" },
    at_resistance: { label: "At Resistance", color: "text-[#f6465d]" },
    near_resistance: { label: "Near Resistance", color: "text-[#f6465d]" },
    middle: { label: "Between Zones", color: "text-[#f0b90b]" },
  };
  const zone = zoneLabels[zones.currentZone] || zoneLabels.middle;

  return (
    <div className="space-y-2" data-testid="section-zones">
      <div className="flex items-center gap-2">
        <Target className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs font-semibold text-foreground">Price Zones</span>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-muted-foreground">Current Zone:</span>
        <Badge variant="outline" className={`text-[10px] ${zone.color} border-current`} data-testid="badge-current-zone">{zone.label}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Card className="p-2.5">
          <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
            <ArrowDown className="w-3 h-3 text-[#0ecb81]" /> Nearest Support
          </div>
          {zones.nearestSupport ? (
            <>
              <div className="text-xs font-mono font-semibold text-[#0ecb81]">{formatPrice(zones.nearestSupport.price)}</div>
              <div className="text-[10px] text-muted-foreground">{zones.nearestSupport.distance}% below | {zones.nearestSupport.touches} touches</div>
            </>
          ) : (
            <div className="text-[10px] text-muted-foreground">Not identified</div>
          )}
        </Card>
        <Card className="p-2.5">
          <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
            <ArrowUp className="w-3 h-3 text-[#f6465d]" /> Nearest Resistance
          </div>
          {zones.nearestResistance ? (
            <>
              <div className="text-xs font-mono font-semibold text-[#f6465d]">{formatPrice(zones.nearestResistance.price)}</div>
              <div className="text-[10px] text-muted-foreground">{zones.nearestResistance.distance}% above | {zones.nearestResistance.touches} touches</div>
            </>
          ) : (
            <div className="text-[10px] text-muted-foreground">Not identified</div>
          )}
        </Card>
      </div>

      {(zones.nextSupportBelow || zones.nextResistanceAbove) && (
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2 rounded-md bg-muted/30">
            <div className="text-[10px] text-muted-foreground mb-0.5">Next Support Below</div>
            {zones.nextSupportBelow ? (
              <div className="text-[10px] font-mono text-[#0ecb81]">{formatPrice(zones.nextSupportBelow.price)}</div>
            ) : (
              <div className="text-[10px] text-muted-foreground">--</div>
            )}
          </div>
          <div className="p-2 rounded-md bg-muted/30">
            <div className="text-[10px] text-muted-foreground mb-0.5">Next Resistance Above</div>
            {zones.nextResistanceAbove ? (
              <div className="text-[10px] font-mono text-[#f6465d]">{formatPrice(zones.nextResistanceAbove.price)}</div>
            ) : (
              <div className="text-[10px] text-muted-foreground">--</div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="p-2 rounded-md border border-[#0ecb81]/20 bg-[#0ecb81]/5">
          <div className="text-[10px] text-[#0ecb81] font-medium mb-0.5">Buy Zone</div>
          <div className="text-[10px] text-muted-foreground">{zones.buyZone}</div>
        </div>
        <div className="p-2 rounded-md border border-[#f6465d]/20 bg-[#f6465d]/5">
          <div className="text-[10px] text-[#f6465d] font-medium mb-0.5">Sell Zone</div>
          <div className="text-[10px] text-muted-foreground">{zones.sellZone}</div>
        </div>
      </div>
    </div>
  );
}

function TrendSection({ trend }: { trend: any }) {
  const directionConfig: Record<string, { label: string; color: string; Icon: any }> = {
    strong_up: { label: "Strong Uptrend", color: "text-[#0ecb81]", Icon: TrendingUp },
    up: { label: "Uptrend", color: "text-[#0ecb81]", Icon: TrendingUp },
    sideways: { label: "Sideways", color: "text-[#f0b90b]", Icon: Minus },
    down: { label: "Downtrend", color: "text-[#f6465d]", Icon: TrendingDown },
    strong_down: { label: "Strong Downtrend", color: "text-[#f6465d]", Icon: TrendingDown },
  };
  const config = directionConfig[trend.direction] || directionConfig.sideways;

  return (
    <div className="space-y-2" data-testid="section-trend">
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs font-semibold text-foreground">Market Trend</span>
      </div>
      <div className="flex items-center gap-2">
        <config.Icon className={`w-4 h-4 ${config.color}`} />
        <span className={`text-sm font-bold ${config.color}`} data-testid="text-trend-direction">{config.label}</span>
      </div>
      <p className="text-[10px] text-muted-foreground leading-relaxed">{trend.explain}</p>
    </div>
  );
}

function IndicatorsSection({ indicators }: { indicators: any }) {
  const rsiColor = indicators.rsi.value < 30 ? "text-[#0ecb81]" : indicators.rsi.value > 70 ? "text-[#f6465d]" : "text-foreground";

  return (
    <div className="space-y-2" data-testid="section-indicators">
      <div className="flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs font-semibold text-foreground">Technical Indicators</span>
      </div>

      <div className="space-y-2.5">
        <div className="p-2 rounded-md bg-muted/30">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-medium text-foreground">RSI (Momentum)</span>
            <span className={`text-xs font-mono font-bold ${rsiColor}`} data-testid="text-rsi-value">{indicators.rsi.value}</span>
          </div>
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden mb-1">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(100, indicators.rsi.value)}%`,
                backgroundColor: indicators.rsi.value < 30 ? "#0ecb81" : indicators.rsi.value > 70 ? "#f6465d" : "#f0b90b",
              }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground">{indicators.rsi.explain}</p>
        </div>

        <div className="p-2 rounded-md bg-muted/30">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-medium text-foreground">MACD (Trend Momentum)</span>
            <span className={`text-xs font-mono font-bold ${indicators.macd.value > 0 ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>
              {indicators.macd.value > 0 ? "+" : ""}{indicators.macd.value.toFixed(4)}
            </span>
          </div>
          {(indicators.macd.crossover || indicators.macd.crossunder) && (
            <Badge variant="outline" className={`text-[9px] mb-1 ${indicators.macd.crossover ? "text-[#0ecb81] border-[#0ecb81]" : "text-[#f6465d] border-[#f6465d]"}`}>
              {indicators.macd.crossover ? "BULLISH CROSSOVER" : "BEARISH CROSSOVER"}
            </Badge>
          )}
          <p className="text-[10px] text-muted-foreground">{indicators.macd.explain}</p>
        </div>

        <div className="p-2 rounded-md bg-muted/30">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-medium text-foreground">Volume</span>
            <span className={`text-xs font-mono font-bold ${indicators.volume.ratio > 2 ? "text-[#f0b90b]" : "text-muted-foreground"}`}>
              {indicators.volume.ratio}x avg
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground">{indicators.volume.explain}</p>
        </div>
      </div>
    </div>
  );
}

function SentimentSection({ sentiment, fearGreed }: { sentiment: any; fearGreed: any }) {
  const sentimentLabels: Record<string, { label: string; color: string }> = {
    bullish: { label: "Bullish", color: "text-[#0ecb81]" },
    slightly_bullish: { label: "Slightly Bullish", color: "text-[#0ecb81]" },
    neutral: { label: "Neutral", color: "text-[#f0b90b]" },
    slightly_bearish: { label: "Slightly Bearish", color: "text-[#f6465d]" },
    bearish: { label: "Bearish", color: "text-[#f6465d]" },
  };
  const s = sentimentLabels[sentiment.orderBook] || sentimentLabels.neutral;

  return (
    <div className="space-y-2" data-testid="section-sentiment">
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs font-semibold text-foreground">Market Sentiment</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Card className="p-2.5">
          <div className="text-[10px] text-muted-foreground mb-1">Order Book Sentiment</div>
          <div className={`text-xs font-bold ${s.color}`}>{s.label}</div>
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden mt-1.5 flex">
            <div className="h-full bg-[#0ecb81]" style={{ width: `${sentiment.buyPressure}%` }} />
            <div className="h-full bg-[#f6465d]" style={{ width: `${100 - sentiment.buyPressure}%` }} />
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-[9px] text-[#0ecb81]">Buy {sentiment.buyPressure}%</span>
            <span className="text-[9px] text-[#f6465d]">Sell {(100 - sentiment.buyPressure).toFixed(1)}%</span>
          </div>
        </Card>

        {fearGreed && (
          <Card className="p-2.5">
            <div className="text-[10px] text-muted-foreground mb-1">Fear & Greed Index</div>
            <div className={`text-xs font-bold ${fearGreed.value < 25 ? "text-[#f6465d]" : fearGreed.value < 45 ? "text-orange-400" : fearGreed.value < 55 ? "text-[#f0b90b]" : fearGreed.value < 75 ? "text-[#0ecb81]" : "text-[#0ecb81]"}`}>
              {fearGreed.value} - {fearGreed.classification}
            </div>
            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden mt-1.5">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${fearGreed.value}%`,
                  backgroundColor: fearGreed.value < 25 ? "#f6465d" : fearGreed.value < 45 ? "#f97316" : fearGreed.value < 55 ? "#f0b90b" : "#0ecb81",
                }}
              />
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-[9px] text-muted-foreground">Extreme Fear</span>
              <span className="text-[9px] text-muted-foreground">Extreme Greed</span>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function SignalBadge({ signal }: { signal: any }) {
  const config: Record<string, { label: string; color: string }> = {
    strong_buy: { label: "STRONG BUY", color: "bg-[#0ecb81]/20 text-[#0ecb81] border-[#0ecb81]/30" },
    buy: { label: "BUY", color: "bg-[#0ecb81]/10 text-[#0ecb81] border-[#0ecb81]/20" },
    neutral: { label: "NEUTRAL", color: "bg-muted text-muted-foreground border-border" },
    sell: { label: "SELL", color: "bg-[#f6465d]/10 text-[#f6465d] border-[#f6465d]/20" },
    strong_sell: { label: "STRONG SELL", color: "bg-[#f6465d]/20 text-[#f6465d] border-[#f6465d]/30" },
  };
  const c = config[signal.overall] || config.neutral;

  return (
    <Badge variant="outline" className={`text-[10px] ${c.color}`} data-testid="badge-overall-signal">
      {c.label} (Score: {signal.score})
    </Badge>
  );
}

export function QuickAnalysisSheet({ symbol, open, onOpenChange }: QuickAnalysisProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/market/coin-analysis", symbol],
    queryFn: async () => {
      const res = await fetch(`/api/market/coin-analysis/${symbol}`);
      if (!res.ok) throw new Error("Failed to fetch analysis");
      return res.json();
    },
    enabled: open && !!symbol,
    refetchInterval: 30000,
  });

  const coinName = symbol.replace("USDT", "");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:w-[420px] sm:max-w-[420px] p-0 overflow-hidden">
        <SheetHeader className="px-4 py-3 border-b border-border">
          <SheetTitle className="flex items-center gap-2 flex-wrap" data-testid="text-analysis-title">
            <ShieldCheck className="w-4 h-4 text-[#f0b90b]" />
            <span>Quick Analysis</span>
            <span className="text-muted-foreground">-</span>
            <span>{coinName}/USDT</span>
            {data && <SignalBadge signal={data.signal} />}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Technical analysis summary for {coinName}/USDT
          </SheetDescription>
        </SheetHeader>

        <div className="overflow-y-auto h-[calc(100vh-60px)] p-4 space-y-4">
          {isLoading && (
            <div className="flex items-center justify-center h-40">
              <div className="text-center space-y-2">
                <Loader2 className="w-6 h-6 animate-spin text-[#f0b90b] mx-auto" />
                <p className="text-xs text-muted-foreground">Analyzing {coinName}...</p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center h-40">
              <p className="text-sm text-[#f6465d]">Failed to load analysis. Try again.</p>
            </div>
          )}

          {data && (
            <>
              <VerdictBanner verdict={data.verdict} />
              <div className="h-px bg-border" />
              <ZoneSection zones={data.zones} currentPrice={data.currentPrice} />
              <div className="h-px bg-border" />
              <TrendSection trend={data.trend} />
              <div className="h-px bg-border" />
              <IndicatorsSection indicators={data.indicators} />
              <div className="h-px bg-border" />
              <SentimentSection sentiment={data.sentiment} fearGreed={data.fearGreed} />
              <div className="h-px bg-border" />
              <div className="p-2 rounded-md bg-muted/30">
                <p className="text-[9px] text-muted-foreground text-center leading-relaxed">
                  This analysis is based on technical indicators and order book data.
                  It is not financial advice. Always do your own research before trading.
                  Data refreshes every 30 seconds.
                </p>
              </div>
              <div className="h-4" />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}