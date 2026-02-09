import { useState, useEffect, useRef, useMemo } from "react";
import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useBinanceWebSocket } from "@/hooks/use-binance-ws";
import { useCreateTrade, useTickers, usePortfolio, useCreateAlert, usePendingOrders, useCancelOrder } from "@/hooks/use-trades";
import { useAuth } from "@/hooks/use-auth";
import { LayoutShell } from "@/components/layout-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, type IChartApi } from "lightweight-charts";
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
  Plus,
  Activity,
  X,
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

function computeRSI(klines: KlineData[], period = 14) {
  const result: { time: number; value: number }[] = [];
  if (klines.length < period + 1) return result;
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = klines[i].close - klines[i - 1].close;
    if (diff >= 0) gainSum += diff;
    else lossSum += Math.abs(diff);
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  result.push({ time: klines[period].time, value: rsi });
  for (let i = period + 1; i < klines.length; i++) {
    const diff = klines[i].close - klines[i - 1].close;
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const val = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    result.push({ time: klines[i].time, value: val });
  }
  return result;
}

function computeMACD(klines: KlineData[], fast = 12, slow = 26, signal = 9) {
  const ema = (data: number[], period: number) => {
    const result: number[] = [];
    let sum = 0;
    for (let i = 0; i < period; i++) sum += data[i];
    result[period - 1] = sum / period;
    const mult = 2 / (period + 1);
    for (let i = period; i < data.length; i++) {
      result[i] = (data[i] - result[i - 1]) * mult + result[i - 1];
    }
    return result;
  };
  const closes = klines.map(k => k.close);
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine: number[] = [];
  for (let i = slow - 1; i < closes.length; i++) {
    macdLine[i] = (emaFast[i] || 0) - (emaSlow[i] || 0);
  }
  const macdValues = macdLine.filter((v) => v !== undefined);
  const signalEma = ema(macdValues, signal);
  const result: { time: number; macd: number; signal: number; histogram: number }[] = [];
  const startIdx = slow - 1;
  for (let i = 0; i < macdValues.length; i++) {
    const globalIdx = startIdx + i;
    if (i >= signal - 1 && signalEma[i] !== undefined) {
      result.push({
        time: klines[globalIdx].time,
        macd: macdValues[i],
        signal: signalEma[i],
        histogram: macdValues[i] - signalEma[i],
      });
    }
  }
  return result;
}

function computeBollingerBands(klines: KlineData[], period = 20, multiplier = 2) {
  const result: { time: number; upper: number; middle: number; lower: number }[] = [];
  for (let i = period - 1; i < klines.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += klines[j].close;
    }
    const sma = sum / period;
    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sqSum += (klines[j].close - sma) ** 2;
    }
    const stdDev = Math.sqrt(sqSum / period);
    result.push({
      time: klines[i].time,
      upper: sma + multiplier * stdDev,
      middle: sma,
      lower: sma - multiplier * stdDev,
    });
  }
  return result;
}

const CHART_OPTS_BASE = {
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
    vertLine: { color: "hsl(220, 10%, 30%)", width: 1 as const, style: 2 as const, labelBackgroundColor: "hsl(220, 14%, 16%)" },
    horzLine: { color: "hsl(220, 10%, 30%)", width: 1 as const, style: 2 as const, labelBackgroundColor: "hsl(220, 14%, 16%)" },
  },
  timeScale: {
    borderColor: "hsl(220, 10%, 16%)",
    timeVisible: true,
    secondsVisible: false,
  },
  rightPriceScale: {
    borderColor: "hsl(220, 10%, 16%)",
  },
};

function ChartSection({ symbol, interval, showBollinger, showRSI, showMACD, pendingOrders }: {
  symbol: string; interval: string; showBollinger: boolean; showRSI: boolean; showMACD: boolean;
  pendingOrders?: any[];
}) {
  const mainRef = useRef<HTMLDivElement>(null);
  const rsiRef = useRef<HTMLDivElement>(null);
  const macdRef = useRef<HTMLDivElement>(null);
  const mainChartRef = useRef<IChartApi | null>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);
  const macdChartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<any>(null);
  const orderLinesRef = useRef<any[]>([]);
  const [chartReady, setChartReady] = useState(0);

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
    if (!mainRef.current || !klines || klines.length === 0) return;

    if (mainChartRef.current) { mainChartRef.current.remove(); mainChartRef.current = null; }
    if (rsiChartRef.current) { rsiChartRef.current.remove(); rsiChartRef.current = null; }
    if (macdChartRef.current) { macdChartRef.current.remove(); macdChartRef.current = null; }

    const mainChart = createChart(mainRef.current, { ...CHART_OPTS_BASE, autoSize: true });

    const candleSeries = mainChart.addSeries(CandlestickSeries, {
      upColor: "#0ecb81",
      downColor: "#f6465d",
      borderUpColor: "#0ecb81",
      borderDownColor: "#f6465d",
      wickUpColor: "#0ecb81",
      wickDownColor: "#f6465d",
    });
    candleSeries.setData(klines.map(k => ({
      time: k.time as any, open: k.open, high: k.high, low: k.low, close: k.close,
    })));
    candleSeriesRef.current = candleSeries;

    if (showBollinger) {
      const bands = computeBollingerBands(klines);
      const upperSeries = mainChart.addSeries(LineSeries, {
        color: "rgba(38, 166, 154, 0.6)", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      upperSeries.setData(bands.map(b => ({ time: b.time as any, value: b.upper })));
      const middleSeries = mainChart.addSeries(LineSeries, {
        color: "rgba(255, 183, 77, 0.7)", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      middleSeries.setData(bands.map(b => ({ time: b.time as any, value: b.middle })));
      const lowerSeries = mainChart.addSeries(LineSeries, {
        color: "rgba(239, 83, 80, 0.6)", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      lowerSeries.setData(bands.map(b => ({ time: b.time as any, value: b.lower })));
    }

    const volumeSeries = mainChart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" }, priceScaleId: "volume",
    });
    mainChart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volumeSeries.setData(klines.map(k => ({
      time: k.time as any, value: k.volume,
      color: k.close >= k.open ? "rgba(14, 203, 129, 0.3)" : "rgba(246, 70, 93, 0.3)",
    })));

    mainChart.timeScale().fitContent();
    mainChartRef.current = mainChart;
    setChartReady(prev => prev + 1);

    const chartsToSync: IChartApi[] = [mainChart];

    if (showRSI && rsiRef.current) {
      const rsiChart = createChart(rsiRef.current, {
        ...CHART_OPTS_BASE,
        autoSize: true,
        rightPriceScale: { borderColor: "hsl(220, 10%, 16%)", scaleMargins: { top: 0.1, bottom: 0.1 } },
      });

      const rsiData = computeRSI(klines);
      const rsiLine = rsiChart.addSeries(LineSeries, {
        color: "#b39ddb", lineWidth: 1, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false,
      });
      rsiLine.setData(rsiData.map(d => ({ time: d.time as any, value: d.value })));

      const ob70 = rsiChart.addSeries(LineSeries, {
        color: "rgba(239, 83, 80, 0.3)", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      ob70.setData(rsiData.map(d => ({ time: d.time as any, value: 70 })));

      const os30 = rsiChart.addSeries(LineSeries, {
        color: "rgba(38, 166, 154, 0.3)", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      os30.setData(rsiData.map(d => ({ time: d.time as any, value: 30 })));

      rsiChart.timeScale().fitContent();
      rsiChart.timeScale().applyOptions({ visible: !showMACD });
      rsiChartRef.current = rsiChart;
      chartsToSync.push(rsiChart);
    }

    if (showMACD && macdRef.current) {
      const macdChart = createChart(macdRef.current, {
        ...CHART_OPTS_BASE,
        autoSize: true,
        rightPriceScale: { borderColor: "hsl(220, 10%, 16%)", scaleMargins: { top: 0.1, bottom: 0.1 } },
      });

      const macdData = computeMACD(klines);

      const macdLine = macdChart.addSeries(LineSeries, {
        color: "#42a5f5", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      macdLine.setData(macdData.map(d => ({ time: d.time as any, value: d.macd })));

      const signalLine = macdChart.addSeries(LineSeries, {
        color: "#ff7043", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      signalLine.setData(macdData.map(d => ({ time: d.time as any, value: d.signal })));

      const histSeries = macdChart.addSeries(HistogramSeries, {
        priceFormat: { type: "price" }, priceScaleId: "macd_hist",
      });
      macdChart.priceScale("macd_hist").applyOptions({ scaleMargins: { top: 0.7, bottom: 0 } });
      histSeries.setData(macdData.map(d => ({
        time: d.time as any, value: d.histogram,
        color: d.histogram >= 0 ? "rgba(14, 203, 129, 0.5)" : "rgba(246, 70, 93, 0.5)",
      })));

      macdChart.timeScale().fitContent();
      macdChartRef.current = macdChart;
      chartsToSync.push(macdChart);
    }

    if (chartsToSync.length > 1) {
      let isSyncing = false;
      chartsToSync.forEach((chart, idx) => {
        chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (isSyncing || !range) return;
          isSyncing = true;
          chartsToSync.forEach((other, otherIdx) => {
            if (idx !== otherIdx) {
              other.timeScale().setVisibleLogicalRange(range);
            }
          });
          isSyncing = false;
        });
      });
    }

    if (!showRSI && !showMACD) {
      mainChart.timeScale().applyOptions({ visible: true });
    } else {
      mainChart.timeScale().applyOptions({ visible: false });
    }

    return () => {
      mainChart.remove(); mainChartRef.current = null;
      candleSeriesRef.current = null;
      orderLinesRef.current = [];
      if (rsiChartRef.current) { rsiChartRef.current.remove(); rsiChartRef.current = null; }
      if (macdChartRef.current) { macdChartRef.current.remove(); macdChartRef.current = null; }
    };
  }, [klines, showBollinger, showRSI, showMACD]);

  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    orderLinesRef.current.forEach(line => {
      try { series.removePriceLine(line); } catch {}
    });
    orderLinesRef.current = [];

    if (!pendingOrders || pendingOrders.length === 0) return;

    const orderTypeLabels: Record<string, string> = {
      market: "MKT",
      limit: "LMT",
      stop_limit: "SL",
      stop_market: "SM",
    };

    for (const order of pendingOrders) {
      const isBuy = order.type === "buy";
      const color = isBuy ? "#0ecb81" : "#f6465d";
      const label = `${orderTypeLabels[order.orderType] || order.orderType} ${order.type.toUpperCase()} ${Number(order.quantity).toFixed(4)}`;

      if (order.limitPrice) {
        const priceLine = series.createPriceLine({
          price: Number(order.limitPrice),
          color,
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: `${label} @ LMT`,
        });
        orderLinesRef.current.push(priceLine);
      }

      if (order.stopPrice) {
        const stopLine = series.createPriceLine({
          price: Number(order.stopPrice),
          color: isBuy ? "rgba(14, 203, 129, 0.6)" : "rgba(246, 70, 93, 0.6)",
          lineWidth: 1,
          lineStyle: 3,
          axisLabelVisible: true,
          title: `${label} @ STP`,
        });
        orderLinesRef.current.push(stopLine);
      }

      if (!order.limitPrice && !order.stopPrice) {
        const priceLine = series.createPriceLine({
          price: Number(order.price),
          color,
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: label,
        });
        orderLinesRef.current.push(priceLine);
      }
    }
  }, [pendingOrders, chartReady]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-[#0ecb81]" />
      </div>
    );
  }

  const subPanelCount = (showRSI ? 1 : 0) + (showMACD ? 1 : 0);
  const mainHeight = subPanelCount === 0 ? "100%" : subPanelCount === 1 ? "70%" : "55%";
  const subHeight = subPanelCount === 2 ? "22.5%" : "30%";

  return (
    <div className="w-full h-full flex flex-col" data-testid="chart-container">
      <div style={{ height: mainHeight }} className="w-full min-h-0">
        <div ref={mainRef} className="w-full h-full" />
      </div>
      {showRSI && (
        <div style={{ height: subHeight }} className="w-full min-h-0 border-t border-border relative">
          <span className="absolute top-1 left-2 text-[9px] text-muted-foreground z-10 font-mono">RSI(14)</span>
          <div ref={rsiRef} className="w-full h-full" />
        </div>
      )}
      {showMACD && (
        <div style={{ height: subHeight }} className="w-full min-h-0 border-t border-border relative">
          <span className="absolute top-1 left-2 text-[9px] text-muted-foreground z-10 font-mono">MACD(12,26,9)</span>
          <div ref={macdRef} className="w-full h-full" />
        </div>
      )}
    </div>
  );
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
  const [orderType, setOrderType] = useState<"market" | "limit" | "stop_limit" | "stop_market">("market");
  const [inputMode, setInputMode] = useState<"token" | "usdt">("usdt");
  const [amount, setAmount] = useState("");
  const [limitPriceVal, setLimitPriceVal] = useState("");
  const [stopPriceVal, setStopPriceVal] = useState("");
  const [sliderValue, setSliderValue] = useState(0);
  const [orderTypeOpen, setOrderTypeOpen] = useState(false);
  const createTrade = useCreateTrade();
  const { data: pendingData } = usePendingOrders();
  const cancelOrder = useCancelOrder();
  const { user } = useAuth();
  const { data: portfolioData } = usePortfolio();
  const coinName = symbol.replace("USDT", "");

  const holding = (portfolioData as any[] | undefined)?.find((p: any) => p.symbol === symbol);
  const holdingQty = holding ? Number(holding.quantity) : 0;

  const numAmount = Number(amount) || 0;

  const effectivePrice = orderType === "limit" || orderType === "stop_limit"
    ? (Number(limitPriceVal) || currentPrice)
    : currentPrice;

  const tokenQty = inputMode === "token" ? numAmount : (effectivePrice > 0 ? numAmount / effectivePrice : 0);
  const usdtTotal = inputMode === "usdt" ? numAmount : numAmount * effectivePrice;

  const minUsdt = 5;
  const isBelowMin = usdtTotal > 0 && usdtTotal < minUsdt;

  const maxBuyUsdt = user ? Number(user.balance) : 0;
  const maxSellUsdt = holdingQty * effectivePrice;

  const pendingOrders = (pendingData as any[] || []).filter((o: any) => o.symbol === symbol);

  const orderTypeLabels: Record<string, string> = {
    market: "Market",
    limit: "Limit",
    stop_limit: "Stop Limit",
    stop_market: "Stop Market",
  };

  function handlePercentClick(pct: number) {
    if (type === "buy") {
      const usdtAmt = maxBuyUsdt * (pct / 100);
      if (inputMode === "usdt") {
        setAmount(usdtAmt.toFixed(2));
      } else {
        const tokenAmt = effectivePrice > 0 ? usdtAmt / effectivePrice : 0;
        setAmount(tokenAmt.toFixed(6));
      }
    } else {
      const tokenAmt = holdingQty * (pct / 100);
      if (inputMode === "token") {
        setAmount(tokenAmt.toFixed(6));
      } else {
        const usdtAmt = tokenAmt * effectivePrice;
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

    const tradeData: any = {
      symbol,
      type,
      quantity: parseFloat(tokenQty.toFixed(8)),
      price: currentPrice,
      orderType,
    };

    if (orderType === "limit" || orderType === "stop_limit") {
      const lp = Number(limitPriceVal);
      if (!lp || lp <= 0) return;
      tradeData.limitPrice = lp;
    }
    if (orderType === "stop_limit" || orderType === "stop_market") {
      const sp = Number(stopPriceVal);
      if (!sp || sp <= 0) return;
      tradeData.stopPrice = sp;
    }

    createTrade.mutate(tradeData, {
      onSuccess: () => {
        setAmount("");
        setSliderValue(0);
        onComplete?.();
      },
    });
  }

  function handleTypeChange(newType: "buy" | "sell") {
    setType(newType);
    setAmount("");
    setSliderValue(0);
  }

  function toggleInputMode() {
    if (numAmount > 0 && effectivePrice > 0) {
      if (inputMode === "usdt") {
        setAmount((numAmount / effectivePrice).toFixed(6));
      } else {
        setAmount((numAmount * effectivePrice).toFixed(2));
      }
    }
    setInputMode(prev => prev === "usdt" ? "token" : "usdt");
  }

  const showLimitPrice = orderType === "limit" || orderType === "stop_limit";
  const showStopPrice = orderType === "stop_limit" || orderType === "stop_market";

  return (
    <div data-testid="trade-panel">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
        <span className="text-xs text-muted-foreground font-medium">Spot</span>
        <div className="relative">
          <button
            type="button"
            className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer"
            onClick={() => setOrderTypeOpen(!orderTypeOpen)}
            data-testid="button-order-type-dropdown"
          >
            {orderTypeLabels[orderType]} <ChevronDown className="w-3 h-3" />
          </button>
          {orderTypeOpen && (
            <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-md shadow-lg z-50 min-w-[120px]">
              {(["market", "limit", "stop_limit", "stop_market"] as const).map((ot) => (
                <button
                  key={ot}
                  type="button"
                  className={`block w-full text-left px-3 py-1.5 text-xs hover-elevate ${orderType === ot ? "text-foreground font-medium" : "text-muted-foreground"}`}
                  onClick={() => { setOrderType(ot); setOrderTypeOpen(false); }}
                  data-testid={`button-order-type-${ot}`}
                >
                  {orderTypeLabels[ot]}
                </button>
              ))}
            </div>
          )}
        </div>
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

        {showStopPrice && (
          <div>
            <label className="text-[10px] text-muted-foreground mb-0.5 block">Stop Price</label>
            <Input
              type="number"
              step="any"
              min="0"
              value={stopPriceVal}
              onChange={(e) => setStopPriceVal(e.target.value)}
              placeholder="Stop trigger price"
              className="font-mono text-xs bg-background/50 border-border h-8"
              data-testid="input-stop-price"
            />
          </div>
        )}

        <div>
          <label className="text-[10px] text-muted-foreground mb-0.5 block">Price</label>
          {showLimitPrice ? (
            <Input
              type="number"
              step="any"
              min="0"
              value={limitPriceVal}
              onChange={(e) => setLimitPriceVal(e.target.value)}
              placeholder="Limit price"
              className="font-mono text-xs bg-background/50 border-border h-8"
              data-testid="input-limit-price"
            />
          ) : (
            <div className="flex items-center gap-2">
              <Input
                value={`${formatPrice(currentPrice)}`}
                disabled
                className="font-mono text-xs bg-background/50 border-border h-8 flex-1"
                data-testid="input-price"
              />
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                {orderType === "stop_market" ? "Market" : "Market Price"}
              </span>
            </div>
          )}
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
                  <>{effectivePrice > 0 ? (maxBuyUsdt / effectivePrice).toFixed(6) : "0.000000"} {coinName}</>
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

        {pendingOrders.length > 0 && (
          <div className="border-t border-border pt-2">
            <div className="text-[10px] text-muted-foreground font-medium mb-1">Open Orders ({pendingOrders.length})</div>
            <div className="space-y-1">
              {pendingOrders.map((order: any) => (
                <div key={order.id} className="flex items-center justify-between text-[10px] bg-background/50 rounded-md px-2 py-1.5">
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1">
                      <span className={order.type === "buy" ? "text-[#0ecb81] font-medium" : "text-[#f6465d] font-medium"}>
                        {order.type.toUpperCase()}
                      </span>
                      <Badge variant="outline" className="text-[8px] px-1 py-0">
                        {orderTypeLabels[order.orderType as string] || order.orderType}
                      </Badge>
                    </div>
                    <span className="text-muted-foreground font-mono">
                      {Number(order.quantity).toFixed(6)} @ ${formatPrice(order.limitPrice || order.stopPrice || order.price)}
                    </span>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => cancelOrder.mutate(order.id)}
                    disabled={cancelOrder.isPending}
                    data-testid={`button-cancel-order-${order.id}`}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
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

  const { data: pendingData } = usePendingOrders();
  const cancelOrder = useCancelOrder();
  const allPendingOrders = (pendingData as any[] || []);
  const symbolPendingOrders = allPendingOrders.filter((o: any) => o.symbol === symbol);

  const [showBollinger, setShowBollinger] = useState(false);
  const [showRSI, setShowRSI] = useState(false);
  const [showMACD, setShowMACD] = useState(false);
  const [isBuySheetOpen, setIsBuySheetOpen] = useState(false);
  const [isSellSheetOpen, setIsSellSheetOpen] = useState(false);
  const [isAlertSheetOpen, setIsAlertSheetOpen] = useState(false);
  const [alertTab, setAlertTab] = useState<"price" | "indicator">("price");
  const [alertPrice, setAlertPrice] = useState("");
  const [alertDirection, setAlertDirection] = useState<"above" | "below">("above");
  const [indicatorType, setIndicatorType] = useState("bollinger_bands");
  const [indicatorCondition, setIndicatorCondition] = useState("bb_lower");
  const [indicatorInterval, setIndicatorInterval] = useState("1h");
  const [alertTelegram, setAlertTelegram] = useState(true);
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
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => {
                setAlertPrice(currentPrice.toString());
                setIsAlertSheetOpen(true);
              }}
              data-testid="button-create-alert"
            >
              <Bell className="w-3.5 h-3.5 text-[#f0b90b]" />
              Create Alert
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
              <div className="ml-2 border-l border-border pl-2 flex items-center gap-3">
                <label
                  className="flex items-center gap-1.5 cursor-pointer select-none"
                  data-testid="label-bollinger-toggle"
                >
                  <input
                    type="checkbox"
                    checked={showBollinger}
                    onChange={(e) => setShowBollinger(e.target.checked)}
                    className="w-3 h-3 rounded accent-[#f0b90b] cursor-pointer"
                    data-testid="checkbox-bollinger"
                  />
                  <span className="text-[10px] text-muted-foreground">BB</span>
                </label>
                <label
                  className="flex items-center gap-1.5 cursor-pointer select-none"
                  data-testid="label-rsi-toggle"
                >
                  <input
                    type="checkbox"
                    checked={showRSI}
                    onChange={(e) => setShowRSI(e.target.checked)}
                    className="w-3 h-3 rounded accent-[#b39ddb] cursor-pointer"
                    data-testid="checkbox-rsi"
                  />
                  <span className="text-[10px] text-muted-foreground">RSI</span>
                </label>
                <label
                  className="flex items-center gap-1.5 cursor-pointer select-none"
                  data-testid="label-macd-toggle"
                >
                  <input
                    type="checkbox"
                    checked={showMACD}
                    onChange={(e) => setShowMACD(e.target.checked)}
                    className="w-3 h-3 rounded accent-[#42a5f5] cursor-pointer"
                    data-testid="checkbox-macd"
                  />
                  <span className="text-[10px] text-muted-foreground">MACD</span>
                </label>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <ChartSection symbol={symbol} interval={interval} showBollinger={showBollinger} showRSI={showRSI} showMACD={showMACD} pendingOrders={symbolPendingOrders} />
            </div>

            {allPendingOrders.length > 0 && (
              <div className="border-t border-border overflow-y-auto shrink-0" style={{ maxHeight: "140px" }}>
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-border sticky top-0 bg-card z-10">
                  <span className="text-xs font-medium text-foreground">Open Orders ({allPendingOrders.length})</span>
                </div>
                <div className="text-[10px] font-mono overflow-x-auto">
                  <div className="grid grid-cols-[80px_60px_70px_1fr_80px_80px_40px] gap-1 px-3 py-1 text-muted-foreground border-b border-border sticky top-[29px] bg-card z-10 min-w-[520px]">
                    <span>Date</span>
                    <span>Pair</span>
                    <span>Type</span>
                    <span>Side/Price</span>
                    <span className="text-right">Amount</span>
                    <span className="text-right">Total</span>
                    <span></span>
                  </div>
                  {allPendingOrders.map((order: any) => {
                    const orderTypeLabel: Record<string, string> = { limit: "Limit", stop_limit: "Stop Limit", stop_market: "Stop Mkt" };
                    const displayPrice = order.limitPrice || order.stopPrice || order.price;
                    const total = Number(order.quantity) * Number(displayPrice);
                    const date = order.timestamp ? new Date(order.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
                    return (
                      <div
                        key={order.id}
                        className="grid grid-cols-[80px_60px_70px_1fr_80px_80px_40px] gap-1 px-3 py-1.5 items-center hover-elevate min-w-[520px]"
                        data-testid={`row-open-order-${order.id}`}
                      >
                        <span className="text-muted-foreground">{date}</span>
                        <span className="text-foreground">{order.symbol.replace("USDT", "")}</span>
                        <Badge variant="outline" className="text-[8px] px-1 py-0 w-fit">
                          {orderTypeLabel[order.orderType] || order.orderType}
                        </Badge>
                        <div className="flex items-center gap-1">
                          <span className={order.type === "buy" ? "text-[#0ecb81] font-medium" : "text-[#f6465d] font-medium"}>
                            {order.type.toUpperCase()}
                          </span>
                          <span className="text-muted-foreground">@</span>
                          <span className="text-foreground">${formatPrice(Number(displayPrice))}</span>
                          {order.stopPrice && order.limitPrice && (
                            <span className="text-muted-foreground ml-1">(stp: ${formatPrice(Number(order.stopPrice))})</span>
                          )}
                        </div>
                        <span className="text-right text-foreground">{Number(order.quantity).toFixed(6)}</span>
                        <span className="text-right text-foreground">${total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                        <div className="flex justify-end">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => cancelOrder.mutate(order.id)}
                            disabled={cancelOrder.isPending}
                            data-testid={`button-cancel-open-order-${order.id}`}
                          >
                            <X className="w-3 h-3 text-[#f6465d]" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
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
          <SheetContent side="bottom" className="h-auto max-h-[70vh] px-0 pb-safe">
            <SheetHeader className="px-4 pb-2 border-b border-border">
              <SheetTitle className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-[#f0b90b]" />
                Create Alert - {coinName}/USDT
              </SheetTitle>
            </SheetHeader>
            <div className="p-4 space-y-4">
              <div className="flex gap-1 p-0.5 bg-muted rounded-md" data-testid="alert-type-tabs">
                <button
                  className={`flex-1 text-xs font-medium py-1.5 rounded-sm transition-colors ${alertTab === "price" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
                  onClick={() => setAlertTab("price")}
                  data-testid="button-alert-tab-price"
                >
                  Price Alert
                </button>
                <button
                  className={`flex-1 text-xs font-medium py-1.5 rounded-sm transition-colors ${alertTab === "indicator" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
                  onClick={() => setAlertTab("indicator")}
                  data-testid="button-alert-tab-indicator"
                >
                  Indicator Alert
                </button>
              </div>

              {alertTab === "price" && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <Button
                      variant={alertDirection === "above" ? "default" : "outline"}
                      size="sm"
                      className={`flex-1 ${alertDirection === "above" ? "bg-[#0ecb81] text-white" : ""}`}
                      onClick={() => setAlertDirection("above")}
                      data-testid="button-alert-above"
                    >
                      <TrendingUp className="w-3 h-3 mr-1" />
                      Above
                    </Button>
                    <Button
                      variant={alertDirection === "below" ? "default" : "outline"}
                      size="sm"
                      className={`flex-1 ${alertDirection === "below" ? "bg-[#f6465d] text-white" : ""}`}
                      onClick={() => setAlertDirection("below")}
                      data-testid="button-alert-below"
                    >
                      <TrendingDown className="w-3 h-3 mr-1" />
                      Below
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
                </div>
              )}

              {alertTab === "indicator" && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block">Indicator</label>
                    <div className="flex gap-2">
                      <Button
                        variant={indicatorType === "bollinger_bands" ? "default" : "outline"}
                        size="sm"
                        className={`flex-1 ${indicatorType === "bollinger_bands" ? "bg-[#f0b90b] text-black" : ""}`}
                        onClick={() => setIndicatorType("bollinger_bands")}
                        data-testid="button-indicator-bb"
                      >
                        <Activity className="w-3 h-3 mr-1" />
                        Bollinger Bands
                      </Button>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block">Condition</label>
                    <div className="flex gap-2">
                      <Button
                        variant={indicatorCondition === "bb_upper" ? "default" : "outline"}
                        size="sm"
                        className={`flex-1 ${indicatorCondition === "bb_upper" ? "bg-[#f6465d] text-white" : ""}`}
                        onClick={() => setIndicatorCondition("bb_upper")}
                        data-testid="button-condition-bb-upper"
                      >
                        <TrendingUp className="w-3 h-3 mr-1" />
                        Hits Upper Band
                      </Button>
                      <Button
                        variant={indicatorCondition === "bb_lower" ? "default" : "outline"}
                        size="sm"
                        className={`flex-1 ${indicatorCondition === "bb_lower" ? "bg-[#0ecb81] text-white" : ""}`}
                        onClick={() => setIndicatorCondition("bb_lower")}
                        data-testid="button-condition-bb-lower"
                      >
                        <TrendingDown className="w-3 h-3 mr-1" />
                        Hits Lower Band
                      </Button>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block">Chart Timeframe</label>
                    <div className="flex gap-1 flex-wrap">
                      {[
                        { value: "1m", label: "1m" },
                        { value: "5m", label: "5m" },
                        { value: "15m", label: "15m" },
                        { value: "1h", label: "1H" },
                        { value: "4h", label: "4H" },
                        { value: "1d", label: "1D" },
                        { value: "1w", label: "1W" },
                      ].map(tf => (
                        <Button
                          key={tf.value}
                          variant={indicatorInterval === tf.value ? "secondary" : "ghost"}
                          size="sm"
                          className={`text-xs h-7 px-3 toggle-elevate ${indicatorInterval === tf.value ? "toggle-elevated" : ""}`}
                          onClick={() => setIndicatorInterval(tf.value)}
                          data-testid={`button-tf-${tf.value}`}
                        >
                          {tf.label}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="text-xs text-muted-foreground bg-muted/50 p-2.5 rounded-md">
                    <Activity className="w-3 h-3 inline mr-1" />
                    Alert when {coinName}/USDT {indicatorCondition === "bb_upper" ? "hits the upper" : "hits the lower"} Bollinger Band on the {indicatorInterval} chart (20-period, 2 std dev)
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between p-3 border border-border rounded-md">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-[#0088cc] flex items-center justify-center">
                    <span className="text-white text-[10px] font-bold">TG</span>
                  </div>
                  <div>
                    <div className="text-xs font-medium">Notify on Telegram</div>
                    <div className="text-[10px] text-muted-foreground">Send alert to your Telegram when triggered</div>
                  </div>
                </div>
                <button
                  className={`w-10 h-5 rounded-full transition-colors relative ${alertTelegram ? "bg-[#0088cc]" : "bg-muted"}`}
                  onClick={() => setAlertTelegram(!alertTelegram)}
                  data-testid="toggle-alert-telegram"
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${alertTelegram ? "left-5.5 translate-x-0.5" : "left-0.5"}`} />
                </button>
              </div>

              <Button
                className="w-full bg-[#0ecb81] text-white font-bold"
                disabled={createAlert.isPending || (alertTab === "price" && !alertPrice)}
                onClick={() => {
                  if (alertTab === "price") {
                    createAlert.mutate(
                      {
                        symbol,
                        targetPrice: parseFloat(alertPrice),
                        direction: alertDirection,
                        alertType: "price",
                        notifyTelegram: alertTelegram,
                      },
                      { onSuccess: () => setIsAlertSheetOpen(false) }
                    );
                  } else {
                    createAlert.mutate(
                      {
                        symbol,
                        targetPrice: 0,
                        direction: indicatorCondition === "bb_upper" ? "above" : "below",
                        alertType: "indicator",
                        indicator: indicatorType,
                        indicatorCondition,
                        chartInterval: indicatorInterval,
                        notifyTelegram: alertTelegram,
                      },
                      { onSuccess: () => setIsAlertSheetOpen(false) }
                    );
                  }
                }}
                data-testid="button-confirm-alert"
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
