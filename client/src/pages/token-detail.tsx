import { useState, useEffect, useRef, useMemo } from "react";
import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useBinanceWebSocket } from "@/hooks/use-binance-ws";
import { useCreateTrade, useTickers, usePortfolio, useCreateAlert } from "@/hooks/use-trades";
import { useAuth } from "@/hooks/use-auth";
import { LayoutShell } from "@/components/layout-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { createChart, CandlestickSeries, HistogramSeries, type IChartApi } from "lightweight-charts";
import {
  ArrowLeft,
  Loader2,
  TrendingUp,
  TrendingDown,
  Wifi,
  WifiOff,
  BarChart3,
  ChevronDown,
  Bell,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

interface KlineData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const INTERVALS = [
  { label: "1m", value: "1m" },
  { label: "5m", value: "5m" },
  { label: "15m", value: "15m" },
  { label: "1H", value: "1h" },
  { label: "4H", value: "4h" },
  { label: "1D", value: "1d" },
  { label: "1W", value: "1w" },
  { label: "1M", value: "1M" },
];

function formatPrice(price: number) {
  if (price >= 1000) return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(8);
}

function formatVolume(vol: number) {
  if (vol >= 1e9) return (vol / 1e9).toFixed(2) + "B";
  if (vol >= 1e6) return (vol / 1e6).toFixed(2) + "M";
  if (vol >= 1e3) return (vol / 1e3).toFixed(2) + "K";
  return vol.toFixed(2);
}

function PriceChart({ symbol, interval }: { symbol: string; interval: string }) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const { data: klines, isLoading } = useQuery<KlineData[]>({
    queryKey: ["/api/market/klines", symbol, interval],
    queryFn: async () => {
      const res = await fetch(`/api/market/klines?symbol=${symbol}&interval=${interval}&limit=500`);
      if (!res.ok) throw new Error("Failed to fetch klines");
      return res.json();
    },
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (!chartContainerRef.current || !klines || klines.length === 0) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: "transparent" },
        textColor: "hsl(220, 10%, 50%)",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "hsl(220, 10%, 14%)" },
        horzLines: { color: "hsl(220, 10%, 14%)" },
      },
      crosshair: {
        vertLine: { color: "hsl(220, 10%, 30%)", width: 1, style: 2, labelBackgroundColor: "hsl(220, 14%, 16%)" },
        horzLine: { color: "hsl(220, 10%, 30%)", width: 1, style: 2, labelBackgroundColor: "hsl(220, 14%, 16%)" },
      },
      timeScale: {
        borderColor: "hsl(220, 10%, 16%)",
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: "hsl(220, 10%, 16%)",
      },
      autoSize: true,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#0ecb81",
      downColor: "#f6465d",
      borderUpColor: "#0ecb81",
      borderDownColor: "#f6465d",
      wickUpColor: "#0ecb81",
      wickDownColor: "#f6465d",
    });

    candleSeries.setData(klines.map(k => ({
      time: k.time as any,
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
    })));

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });

    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    volumeSeries.setData(klines.map(k => ({
      time: k.time as any,
      value: k.volume,
      color: k.close >= k.open ? "rgba(14, 203, 129, 0.3)" : "rgba(246, 70, 93, 0.3)",
    })));

    chart.timeScale().fitContent();
    chartRef.current = chart;

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [klines]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-[#0ecb81]" />
      </div>
    );
  }

  return <div ref={chartContainerRef} className="w-full h-full" data-testid="chart-container" />;
}

function OrderBookSimulated({ price, symbol }: { price: number; symbol: string }) {
  const asks = useMemo(() => {
    const rows = [];
    for (let i = 9; i >= 0; i--) {
      const offset = price * (0.0001 * (i + 1) + Math.random() * 0.0003);
      const askPrice = price + offset;
      const qty = (Math.random() * 2 + 0.01).toFixed(5);
      rows.push({ price: askPrice, qty: parseFloat(qty), total: askPrice * parseFloat(qty) });
    }
    return rows;
  }, [price, symbol]);

  const bids = useMemo(() => {
    const rows = [];
    for (let i = 0; i < 10; i++) {
      const offset = price * (0.0001 * (i + 1) + Math.random() * 0.0003);
      const bidPrice = price - offset;
      const qty = (Math.random() * 2 + 0.01).toFixed(5);
      rows.push({ price: bidPrice, qty: parseFloat(qty), total: bidPrice * parseFloat(qty) });
    }
    return rows;
  }, [price, symbol]);

  const maxTotal = Math.max(...asks.map(a => a.total), ...bids.map(b => b.total));

  return (
    <div className="text-xs font-mono" data-testid="order-book">
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border">
        <span className="text-muted-foreground font-sans font-medium text-xs">Order Book</span>
      </div>
      <div className="grid grid-cols-3 px-2 py-1 text-muted-foreground text-[10px]">
        <span>Price(USDT)</span>
        <span className="text-right">Amount</span>
        <span className="text-right">Total</span>
      </div>
      <div className="space-y-px">
        {asks.map((a, i) => (
          <div key={`ask-${i}`} className="grid grid-cols-3 px-2 py-0.5 relative">
            <div
              className="absolute right-0 top-0 bottom-0 bg-[#f6465d]/10"
              style={{ width: `${(a.total / maxTotal) * 100}%` }}
            />
            <span className="text-[#f6465d] relative z-10">{formatPrice(a.price)}</span>
            <span className="text-right text-foreground/70 relative z-10">{a.qty.toFixed(5)}</span>
            <span className="text-right text-foreground/70 relative z-10">{formatVolume(a.total)}</span>
          </div>
        ))}
      </div>
      <div className="px-2 py-1.5 border-y border-border">
        <span className="text-lg font-bold text-foreground">${formatPrice(price)}</span>
      </div>
      <div className="space-y-px">
        {bids.map((b, i) => (
          <div key={`bid-${i}`} className="grid grid-cols-3 px-2 py-0.5 relative">
            <div
              className="absolute right-0 top-0 bottom-0 bg-[#0ecb81]/10"
              style={{ width: `${(b.total / maxTotal) * 100}%` }}
            />
            <span className="text-[#0ecb81] relative z-10">{formatPrice(b.price)}</span>
            <span className="text-right text-foreground/70 relative z-10">{b.qty.toFixed(5)}</span>
            <span className="text-right text-foreground/70 relative z-10">{formatVolume(b.total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TradePanel({
  symbol,
  currentPrice,
  defaultType = "buy",
  onComplete,
}: {
  symbol: string;
  currentPrice: number;
  defaultType?: "buy" | "sell";
  onComplete?: () => void;
}) {
  const [type, setType] = useState<"buy" | "sell">(defaultType);
  const [inputMode, setInputMode] = useState<"token" | "usdt">("usdt");
  const [amount, setAmount] = useState("");
  const [sliderValue, setSliderValue] = useState(0);
  const createTrade = useCreateTrade();
  const { user } = useAuth();
  const { data: portfolioData } = usePortfolio();
  const coinName = symbol.replace("USDT", "");

  const holding = (portfolioData as any[] | undefined)?.find((p: any) => p.symbol === symbol);
  const holdingQty = holding ? Number(holding.quantity) : 0;

  const numAmount = Number(amount) || 0;

  const tokenQty = inputMode === "token" ? numAmount : (currentPrice > 0 ? numAmount / currentPrice : 0);
  const usdtTotal = inputMode === "usdt" ? numAmount : numAmount * currentPrice;

  const minUsdt = 5;
  const isBelowMin = usdtTotal > 0 && usdtTotal < minUsdt;

  const maxBuyUsdt = user ? Number(user.balance) : 0;
  const maxSellUsdt = holdingQty * currentPrice;

  function handlePercentClick(pct: number) {
    if (type === "buy") {
      const usdtAmt = maxBuyUsdt * (pct / 100);
      if (inputMode === "usdt") {
        setAmount(usdtAmt.toFixed(2));
      } else {
        const tokenAmt = currentPrice > 0 ? usdtAmt / currentPrice : 0;
        setAmount(tokenAmt.toFixed(6));
      }
    } else {
      const tokenAmt = holdingQty * (pct / 100);
      if (inputMode === "token") {
        setAmount(tokenAmt.toFixed(6));
      } else {
        const usdtAmt = tokenAmt * currentPrice;
        setAmount(usdtAmt.toFixed(2));
      }
    }
    setSliderValue(pct);
  }

  function handleSliderChange(val: number) {
    setSliderValue(val);
    handlePercentClick(val);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (tokenQty <= 0 || isBelowMin) return;
    createTrade.mutate(
      { symbol, type, quantity: parseFloat(tokenQty.toFixed(8)), price: currentPrice },
      {
        onSuccess: () => {
          setAmount("");
          setSliderValue(0);
          onComplete?.();
        },
      }
    );
  }

  function handleTypeChange(newType: "buy" | "sell") {
    setType(newType);
    setAmount("");
    setSliderValue(0);
  }

  function toggleInputMode() {
    if (numAmount > 0 && currentPrice > 0) {
      if (inputMode === "usdt") {
        setAmount((numAmount / currentPrice).toFixed(6));
      } else {
        setAmount((numAmount * currentPrice).toFixed(2));
      }
    }
    setInputMode(prev => prev === "usdt" ? "token" : "usdt");
  }

  return (
    <div data-testid="trade-panel">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
        <span className="text-xs text-muted-foreground font-medium">Spot</span>
        <span className="text-[10px] text-muted-foreground">Market Price</span>
      </div>
      <div className="p-3 space-y-3">
        <div className="flex gap-1">
          <Button
            variant={type === "buy" ? "default" : "ghost"}
            size="sm"
            className={`flex-1 text-xs toggle-elevate ${type === "buy" ? "toggle-elevated bg-[#0ecb81] text-white border-[#0ecb81]" : ""}`}
            onClick={() => handleTypeChange("buy")}
            data-testid="button-buy-tab"
          >
            Buy
          </Button>
          <Button
            variant={type === "sell" ? "destructive" : "ghost"}
            size="sm"
            className={`flex-1 text-xs toggle-elevate ${type === "sell" ? "toggle-elevated bg-[#f6465d] text-white border-[#f6465d]" : ""}`}
            onClick={() => handleTypeChange("sell")}
            data-testid="button-sell-tab"
          >
            Sell
          </Button>
        </div>

        <div>
          <label className="text-[10px] text-muted-foreground mb-0.5 block">Price</label>
          <div className="flex items-center gap-2">
            <Input
              value={`${formatPrice(currentPrice)}`}
              disabled
              className="font-mono text-xs bg-background/50 border-border h-8 flex-1"
              data-testid="input-price"
            />
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">Market Price</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-2">
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <label className="text-[10px] text-muted-foreground">
                Total
              </label>
              <span className="text-[10px] text-muted-foreground">
                Minimum 5 <button
                  type="button"
                  className="font-medium text-foreground cursor-pointer"
                  onClick={toggleInputMode}
                  data-testid="button-toggle-input-mode"
                >
                  {inputMode === "usdt" ? "USDT" : coinName} &#9662;
                </button>
              </span>
            </div>
            <Input
              type="number"
              step="any"
              min="0"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setSliderValue(0);
              }}
              placeholder={inputMode === "usdt" ? "Min 5 USDT" : `0.00 ${coinName}`}
              className="font-mono text-xs bg-background/50 border-border h-8"
              data-testid="input-amount"
            />
            {isBelowMin && (
              <p className="text-[10px] text-[#f6465d] mt-0.5" data-testid="text-min-order-error">Minimum order is 5 USDT</p>
            )}
          </div>

          <div className="relative px-1">
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={sliderValue}
              onChange={(e) => handleSliderChange(Number(e.target.value))}
              className="w-full h-1 appearance-none rounded-full cursor-pointer accent-[#0ecb81]"
              style={{
                background: `linear-gradient(to right, ${type === "buy" ? "#0ecb81" : "#f6465d"} ${sliderValue}%, hsl(220, 10%, 20%) ${sliderValue}%)`,
              }}
              data-testid="slider-amount"
            />
            <div className="flex justify-between mt-1">
              {[0, 25, 50, 75, 100].map((mark) => (
                <button
                  key={mark}
                  type="button"
                  className={`w-2 h-2 rounded-full border transition-colors ${
                    sliderValue >= mark
                      ? type === "buy" ? "bg-[#0ecb81] border-[#0ecb81]" : "bg-[#f6465d] border-[#f6465d]"
                      : "bg-background border-border"
                  }`}
                  onClick={() => handlePercentClick(mark)}
                  data-testid={`button-slider-${mark}`}
                />
              ))}
            </div>
          </div>

          <div className="space-y-1 text-xs py-1 border-t border-border">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Avbl</span>
              <span className="font-mono text-foreground" data-testid="text-available">
                {type === "buy" ? (
                  <>{maxBuyUsdt.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT</>
                ) : (
                  <>{holdingQty.toFixed(6)} {coinName}</>
                )}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground cursor-pointer" data-testid="text-max-label">
                {type === "buy" ? "Max Buy" : "Max Sell"}
              </span>
              <span className="font-mono text-foreground" data-testid="text-max-value">
                {type === "buy" ? (
                  <>{currentPrice > 0 ? (maxBuyUsdt / currentPrice).toFixed(6) : "0.000000"} {coinName}</>
                ) : (
                  <>{maxSellUsdt.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT</>
                )}
              </span>
            </div>
            {numAmount > 0 && (
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">
                  {inputMode === "usdt" ? `Amount (${coinName})` : "Total (USDT)"}
                </span>
                <span className="font-mono text-foreground" data-testid="text-converted">
                  {inputMode === "usdt"
                    ? `${tokenQty.toFixed(6)} ${coinName}`
                    : `${usdtTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`
                  }
                </span>
              </div>
            )}
          </div>

          <Button
            type="submit"
            disabled={createTrade.isPending || tokenQty <= 0 || isBelowMin}
            className={`w-full text-xs font-bold text-white ${
              type === "buy"
                ? "bg-[#0ecb81] border-[#0ecb81]"
                : "bg-[#f6465d] border-[#f6465d]"
            }`}
            data-testid="button-submit-trade"
          >
            {createTrade.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              `${type === "buy" ? "Buy" : "Sell"} ${coinName}`
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}

function MarketTrades({ price, symbol }: { price: number; symbol: string }) {
  const trades = useMemo(() => {
    const rows = [];
    const now = Date.now();
    for (let i = 0; i < 20; i++) {
      const isBuy = Math.random() > 0.5;
      const offset = price * (Math.random() * 0.0005);
      const tradePrice = isBuy ? price + offset : price - offset;
      const qty = (Math.random() * 0.5 + 0.0001).toFixed(5);
      const time = new Date(now - i * 1200);
      rows.push({
        price: tradePrice,
        qty: parseFloat(qty),
        time: time.toLocaleTimeString("en-US", { hour12: false }),
        isBuy,
      });
    }
    return rows;
  }, [price, symbol]);

  return (
    <div className="text-xs font-mono" data-testid="market-trades">
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border">
        <span className="text-muted-foreground font-sans font-medium text-xs">Market Trades</span>
      </div>
      <div className="grid grid-cols-3 px-2 py-1 text-muted-foreground text-[10px]">
        <span>Price(USDT)</span>
        <span className="text-right">Amount</span>
        <span className="text-right">Time</span>
      </div>
      <div className="space-y-px">
        {trades.map((t, i) => (
          <div key={i} className="grid grid-cols-3 px-2 py-0.5">
            <span className={t.isBuy ? "text-[#0ecb81]" : "text-[#f6465d]"}>{formatPrice(t.price)}</span>
            <span className="text-right text-foreground/70">{t.qty.toFixed(5)}</span>
            <span className="text-right text-foreground/50">{t.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TokenDetail() {
  const [, params] = useRoute("/trade/:symbol");
  const symbol = params?.symbol?.toUpperCase() || "BTCUSDT";
  const coinName = symbol.replace("USDT", "");
  const [interval, setInterval_] = useState("1h");

  const { connected, priceFlashes } = useBinanceWebSocket();
  const { data: tickers } = useTickers();

  const ticker = (tickers as any[] | undefined)?.find((t: any) => t.symbol === symbol);

  const currentPrice = ticker ? parseFloat(ticker.lastPrice) : 0;
  const change = ticker ? parseFloat(ticker.priceChangePercent) : 0;
  const isPositive = change >= 0;
  const high = ticker ? parseFloat(ticker.highPrice) : 0;
  const low = ticker ? parseFloat(ticker.lowPrice) : 0;
  const volume = ticker ? parseFloat(ticker.volume) : 0;
  const quoteVolume = ticker ? parseFloat(ticker.quoteVolume) : 0;
  const flash = priceFlashes.get(symbol);

  const [isBuySheetOpen, setIsBuySheetOpen] = useState(false);
  const [isSellSheetOpen, setIsSellSheetOpen] = useState(false);
  const [isAlertSheetOpen, setIsAlertSheetOpen] = useState(false);
  const [alertPrice, setAlertPrice] = useState("");
  const [alertDirection, setAlertDirection] = useState<"above" | "below">("above");
  const createAlert = useCreateAlert();

  if (!ticker) {
    return (
      <LayoutShell>
        <div className="flex items-center justify-center h-[60vh]">
          <div className="text-center space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-[#0ecb81] mx-auto" />
            <p className="text-sm text-muted-foreground">Loading {coinName}/USDT...</p>
          </div>
        </div>
      </LayoutShell>
    );
  }

  return (
    <LayoutShell>
      <div className="flex flex-col h-[calc(100vh-3.5rem)] overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-card/50 flex-wrap">
          <Link href="/">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>

          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-foreground" data-testid="text-symbol">{coinName}/USDT</span>
          </div>

          <span
            className={`text-xl font-bold font-mono transition-colors duration-300 ${
              flash === "up" ? "text-[#0ecb81]" : flash === "down" ? "text-[#f6465d]" : "text-foreground"
            }`}
            data-testid="text-current-price"
          >
            ${formatPrice(currentPrice)}
          </span>

          <Badge
            variant="outline"
            className={`text-xs no-default-hover-elevate no-default-active-elevate ${
              isPositive ? "text-[#0ecb81] border-[#0ecb81]/30" : "text-[#f6465d] border-[#f6465d]/30"
            }`}
            data-testid="badge-change"
          >
            {isPositive ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
            {isPositive ? "+" : ""}{change.toFixed(2)}%
          </Badge>

          <div className="hidden md:flex items-center gap-4 ml-4 text-xs">
            <div>
              <span className="text-muted-foreground">24h High </span>
              <span className="font-mono text-foreground" data-testid="text-high">${formatPrice(high)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">24h Low </span>
              <span className="font-mono text-foreground" data-testid="text-low">${formatPrice(low)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">24h Vol({coinName}) </span>
              <span className="font-mono text-foreground" data-testid="text-volume">{formatVolume(volume)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">24h Vol(USDT) </span>
              <span className="font-mono text-foreground">{formatVolume(quoteVolume)}</span>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setAlertPrice(currentPrice.toString());
                setIsAlertSheetOpen(true);
              }}
              data-testid="button-set-alert"
            >
              <Bell className="w-4 h-4 text-[#f0b90b]" />
            </Button>
            {connected ? (
              <Badge variant="outline" className="gap-1 text-[#0ecb81] border-[#0ecb81]/30 text-[10px] no-default-hover-elevate no-default-active-elevate" data-testid="badge-ws-status">
                <Wifi className="w-3 h-3" />
                Live
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 text-muted-foreground text-[10px] no-default-hover-elevate no-default-active-elevate" data-testid="badge-ws-status">
                <WifiOff className="w-3 h-3" />
              </Badge>
            )}
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          <div className="hidden lg:flex flex-col w-56 border-r border-border overflow-y-auto">
            <OrderBookSimulated price={currentPrice} symbol={symbol} />
          </div>

          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border flex-wrap">
              <BarChart3 className="w-3.5 h-3.5 text-muted-foreground mr-1" />
              {INTERVALS.map(iv => (
                <Button
                  key={iv.value}
                  variant={interval === iv.value ? "secondary" : "ghost"}
                  size="sm"
                  className={`text-[10px] h-6 px-2 toggle-elevate ${interval === iv.value ? "toggle-elevated" : ""}`}
                  onClick={() => setInterval_(iv.value)}
                  data-testid={`button-interval-${iv.value}`}
                >
                  {iv.label}
                </Button>
              ))}
            </div>
            <div className="flex-1 min-h-0">
              <PriceChart symbol={symbol} interval={interval} />
            </div>
          </div>

          <div className="hidden md:flex flex-col w-64 border-l border-border">
            <div className="flex-1 overflow-y-auto border-b border-border">
              <TradePanel symbol={symbol} currentPrice={currentPrice} />
            </div>
            <div className="h-64 overflow-y-auto">
              <MarketTrades price={currentPrice} symbol={symbol} />
            </div>
          </div>
        </div>

        {/* Mobile Action Bar */}
        <div className="md:hidden flex gap-2 p-3 bg-background border-t border-border pb-safe">
          <Sheet open={isBuySheetOpen} onOpenChange={setIsBuySheetOpen}>
            <SheetTrigger asChild>
              <Button
                className="flex-1 bg-[#0ecb81] hover:bg-[#0ecb81]/90 text-white font-bold"
                data-testid="button-mobile-buy"
              >
                Buy {coinName}
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="h-[80vh] px-0 pb-safe">
              <SheetHeader className="px-4 pb-2 border-b border-border">
                <SheetTitle>Buy {coinName}</SheetTitle>
              </SheetHeader>
              <div className="overflow-y-auto h-full pb-10">
                <TradePanel symbol={symbol} currentPrice={currentPrice} defaultType="buy" onComplete={() => setIsBuySheetOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>

          <Sheet open={isSellSheetOpen} onOpenChange={setIsSellSheetOpen}>
            <SheetTrigger asChild>
              <Button
                className="flex-1 bg-[#f6465d] hover:bg-[#f6465d]/90 text-white font-bold"
                data-testid="button-mobile-sell"
              >
                Sell {coinName}
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="h-[80vh] px-0 pb-safe">
              <SheetHeader className="px-4 pb-2 border-b border-border">
                <SheetTitle>Sell {coinName}</SheetTitle>
              </SheetHeader>
              <div className="overflow-y-auto h-full pb-10">
                <TradePanel symbol={symbol} currentPrice={currentPrice} defaultType="sell" onComplete={() => setIsSellSheetOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
        </div>

        <Sheet open={isAlertSheetOpen} onOpenChange={setIsAlertSheetOpen}>
          <SheetContent side="bottom" className="h-auto max-h-[50vh] px-0 pb-safe">
            <SheetHeader className="px-4 pb-2 border-b border-border">
              <SheetTitle>Set Price Alert - {coinName}/USDT</SheetTitle>
            </SheetHeader>
            <div className="p-4 space-y-3">
              <div className="flex gap-2">
                <Button
                  variant={alertDirection === "above" ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setAlertDirection("above")}
                  data-testid="button-alert-above"
                >
                  Price goes above
                </Button>
                <Button
                  variant={alertDirection === "below" ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setAlertDirection("below")}
                  data-testid="button-alert-below"
                >
                  Price goes below
                </Button>
              </div>
              <Input
                type="number"
                placeholder="Target price (USDT)"
                value={alertPrice}
                onChange={(e) => setAlertPrice(e.target.value)}
                data-testid="input-alert-price"
              />
              <div className="text-xs text-muted-foreground">
                Current price: ${formatPrice(currentPrice)}
              </div>
              <Button
                className="w-full"
                disabled={createAlert.isPending || !alertPrice}
                onClick={() => {
                  createAlert.mutate(
                    { symbol, targetPrice: parseFloat(alertPrice), direction: alertDirection },
                    { onSuccess: () => setIsAlertSheetOpen(false) }
                  );
                }}
                data-testid="button-confirm-price-alert"
              >
                {createAlert.isPending ? "Creating..." : "Create Alert"}
              </Button>
            </div>
          </SheetContent>
        </Sheet>

        <div className="flex border-t border-border overflow-x-auto bg-card/30">
          <TickerBar />
        </div>
      </div>
    </LayoutShell>
  );
}

function TickerBar() {
  const { data: tickers } = useTickers();

  if (!tickers || (tickers as any[]).length === 0) return null;

  return (
    <div className="flex items-center gap-4 px-3 py-1 text-[10px] font-mono whitespace-nowrap">
      {tickers.slice(0, 10).map((t: any) => {
        const change = parseFloat(t.priceChangePercent);
        const coin = t.symbol.replace("USDT", "");
        return (
          <Link key={t.symbol} href={`/trade/${t.symbol.toLowerCase()}`}>
            <span className="cursor-pointer flex items-center gap-1.5" data-testid={`ticker-bar-${t.symbol}`}>
              <span className="text-muted-foreground">{coin}/USDT</span>
              <span className={change >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]"}>
                {change >= 0 ? "+" : ""}{change.toFixed(2)}%
              </span>
              <span className="text-foreground">${formatPrice(parseFloat(t.lastPrice))}</span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
