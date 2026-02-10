import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { LayoutShell } from "@/components/layout-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Bot, Plus, Trash2, Settings2, TrendingUp, TrendingDown, Zap, Activity, ArrowDown, ArrowUp, Shield, RefreshCw, Eye, ChevronDown, ChevronUp, DollarSign, Target, AlertTriangle } from "lucide-react";
import type { AutopilotBot, DcaBotOrder } from "@shared/schema";

const POPULAR_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "XRPUSDT", "SOLUSDT",
  "ADAUSDT", "DOGEUSDT", "LTCUSDT", "NEARUSDT", "POLUSDT",
  "FILUSDT", "ETCUSDT",
];

interface DcaConfig {
  strategy: string;
  totalCapital: number;
  maxBuySteps: number;
  supportPrice: number;
  orderType: string;
  limitPrice: number;
  buySteps: { step: number; dropPercent: number; percent: number }[];
  sellSteps: { step: number; risePercent: number; percent: number; sellRemaining?: boolean }[];
  riskControl: { supportBreakStop: boolean };
}

const DEFAULT_BUY_STEPS = [
  { step: 1, dropPercent: 0, percent: 20 },
  { step: 2, dropPercent: 4, percent: 20 },
  { step: 3, dropPercent: 8, percent: 25 },
  { step: 4, dropPercent: 12, percent: 20 },
  { step: 5, dropPercent: 18, percent: 15 },
];

const DEFAULT_SELL_STEPS = [
  { step: 1, risePercent: 4, percent: 30 },
  { step: 2, risePercent: 8, percent: 40 },
  { step: 3, risePercent: 12, percent: 100, sellRemaining: true },
];

function CreateDcaBotDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [name, setName] = useState("DCA Spot Bot");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [totalCapital, setTotalCapital] = useState("1000");
  const [orderType, setOrderType] = useState("market");
  const [limitPrice, setLimitPrice] = useState("");
  const [buySteps, setBuySteps] = useState(DEFAULT_BUY_STEPS.map(s => ({ ...s })));
  const [sellSteps, setSellSteps] = useState(DEFAULT_SELL_STEPS.map(s => ({ ...s })));
  const [supportBreakStop, setSupportBreakStop] = useState(true);
  const [selectedSupport, setSelectedSupport] = useState<number>(0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { toast } = useToast();

  const { data: supportData, isLoading: supportLoading } = useQuery<{
    supports: { price: number; touches: number }[];
    resistances: { price: number; touches: number }[];
    currentPrice: number;
    rsi: number;
  }>({
    queryKey: ["/api/dca/support-zones", symbol],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/dca/support-zones/${symbol}`);
      return res.json();
    },
    enabled: open,
  });

  const currentPrice = supportData?.currentPrice || 0;

  useEffect(() => {
    if (supportData?.supports && supportData.supports.length > 0 && selectedSupport === 0) {
      setSelectedSupport(supportData.supports[0].price);
    }
  }, [supportData, selectedSupport]);

  const totalBuyPercent = buySteps.reduce((s, b) => s + b.percent, 0);
  const capital = Number(totalCapital) || 0;

  const buyCalculations = useMemo(() => {
    if (!currentPrice || !capital) return [];
    let entryPrice = orderType === "limit" && limitPrice ? Number(limitPrice) : currentPrice;
    return buySteps.map((step, i) => {
      const triggerPrice = i === 0 ? entryPrice : entryPrice * (1 - step.dropPercent / 100);
      const amount = capital * (step.percent / 100);
      const qty = triggerPrice > 0 ? amount / triggerPrice : 0;
      return { ...step, triggerPrice, amount, qty };
    });
  }, [buySteps, currentPrice, capital, orderType, limitPrice]);

  const avgEntryPrice = useMemo(() => {
    const totalCost = buyCalculations.reduce((s, b) => s + b.amount, 0);
    const totalQty = buyCalculations.reduce((s, b) => s + b.qty, 0);
    return totalQty > 0 ? totalCost / totalQty : 0;
  }, [buyCalculations]);

  const sellCalculations = useMemo(() => {
    if (!avgEntryPrice) return [];
    const totalQty = buyCalculations.reduce((s, b) => s + b.qty, 0);
    let remaining = totalQty;
    return sellSteps.map(step => {
      const triggerPrice = avgEntryPrice * (1 + step.risePercent / 100);
      let sellQty: number;
      if (step.sellRemaining) {
        sellQty = remaining;
      } else {
        sellQty = totalQty * (step.percent / 100);
        if (sellQty > remaining) sellQty = remaining;
      }
      remaining -= sellQty;
      const sellValue = sellQty * triggerPrice;
      const costBasis = sellQty * avgEntryPrice;
      const profit = sellValue - costBasis;
      return { ...step, triggerPrice, sellQty, sellValue, profit };
    });
  }, [sellSteps, avgEntryPrice, buyCalculations]);

  const totalProfit = sellCalculations.reduce((s, sc) => s + sc.profit, 0);

  const updateBuyStep = (index: number, field: string, value: number) => {
    const updated = [...buySteps];
    (updated[index] as any)[field] = value;
    setBuySteps(updated);
  };

  const updateSellStep = (index: number, field: string, value: number) => {
    const updated = [...sellSteps];
    (updated[index] as any)[field] = value;
    setSellSteps(updated);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const config: DcaConfig = {
        strategy: "dca_spot",
        totalCapital: capital,
        maxBuySteps: buySteps.length,
        supportPrice: selectedSupport,
        orderType,
        limitPrice: orderType === "limit" ? Number(limitPrice) : 0,
        buySteps,
        sellSteps,
        riskControl: { supportBreakStop },
      };
      const res = await apiRequest("POST", "/api/autopilot/bots", {
        name: name.trim() || "DCA Spot Bot",
        symbol: symbol.toUpperCase(),
        side: "both",
        tradeAmount: capital,
        strategy: "dca_spot",
        strategyConfig: JSON.stringify(config),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/autopilot/bots"] });
      toast({ title: "DCA Bot Created", description: `${name} is ready. Activate it to start trading.` });
      onOpenChange(false);
      setName("DCA Spot Bot");
      setSymbol("BTCUSDT");
      setTotalCapital("1000");
      setBuySteps(DEFAULT_BUY_STEPS.map(s => ({ ...s })));
      setSellSteps(DEFAULT_SELL_STEPS.map(s => ({ ...s })));
      setSelectedSupport(0);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create bot", variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-[#0ecb81]" />
            Create DCA Spot Bot
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Bot Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="DCA Spot Bot"
                data-testid="input-dca-bot-name"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Total Capital (USDT)</Label>
              <Input
                type="number"
                value={totalCapital}
                onChange={(e) => setTotalCapital(e.target.value)}
                min="10"
                step="10"
                data-testid="input-dca-total-capital"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Select Coin</Label>
            <Select value={symbol} onValueChange={(v) => { setSymbol(v); setSelectedSupport(0); }}>
              <SelectTrigger data-testid="select-dca-symbol">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POPULAR_SYMBOLS.map((s) => (
                  <SelectItem key={s} value={s}>{s.replace("USDT", "/USDT")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {supportLoading ? (
            <div className="flex items-center justify-center py-4">
              <div className="w-5 h-5 border-2 border-[#0ecb81] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : supportData ? (
            <Card className="p-3 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Coin Analysis</span>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-xs text-muted-foreground">Price: <span className="font-mono text-foreground">${currentPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span></span>
                  <Badge variant="secondary" className="text-[10px]">RSI: {supportData.rsi}</Badge>
                </div>
              </div>

              {supportData.supports.length > 0 && (
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1">
                    <Shield className="w-3 h-3 text-[#0ecb81]" />
                    Support Zones (buy zones)
                  </div>
                  <div className="space-y-1">
                    {supportData.supports.slice(0, 4).map((s, i) => {
                      const distFromPrice = ((currentPrice - s.price) / currentPrice * 100);
                      return (
                        <button
                          key={i}
                          className={`w-full text-left px-2 py-1.5 rounded-md text-xs flex items-center justify-between gap-2 transition-colors ${
                            selectedSupport === s.price
                              ? "bg-[#0ecb81]/10 border border-[#0ecb81]/30"
                              : "hover-elevate"
                          }`}
                          onClick={() => setSelectedSupport(s.price)}
                          data-testid={`button-support-${i}`}
                        >
                          <span className="font-mono text-[#0ecb81]">${s.price.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">{s.touches} touches</span>
                            <span className="text-muted-foreground">{distFromPrice.toFixed(1)}% below</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {supportData.resistances.length > 0 && (
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1">
                    <Target className="w-3 h-3 text-[#f6465d]" />
                    Resistance Zones (sell targets)
                  </div>
                  <div className="space-y-1">
                    {supportData.resistances.slice(0, 3).map((r, i) => {
                      const distFromPrice = ((r.price - currentPrice) / currentPrice * 100);
                      return (
                        <div key={i} className="px-2 py-1.5 rounded-md text-xs flex items-center justify-between gap-2">
                          <span className="font-mono text-[#f6465d]">${r.price.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">{r.touches} touches</span>
                            <span className="text-muted-foreground">{distFromPrice.toFixed(1)}% above</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </Card>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Order Type</Label>
              <Select value={orderType} onValueChange={setOrderType}>
                <SelectTrigger data-testid="select-dca-order-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="market">Market Price</SelectItem>
                  <SelectItem value="limit">Limit Order</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {orderType === "limit" && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Limit Price (USDT)</Label>
                <Input
                  type="number"
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(e.target.value)}
                  placeholder={currentPrice.toString()}
                  data-testid="input-dca-limit-price"
                />
              </div>
            )}
          </div>

          <Card className="p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <ArrowDown className="w-3 h-3 text-[#0ecb81]" />
                Buy Steps (DCA)
              </span>
              <Badge variant="secondary" className={`text-[10px] ${totalBuyPercent !== 100 ? "text-[#f6465d]" : "text-[#0ecb81]"}`}>
                Total: {totalBuyPercent}%
              </Badge>
            </div>

            <div className="space-y-2">
              <div className="grid grid-cols-4 gap-2 text-[10px] text-muted-foreground uppercase tracking-wide px-1">
                <span>Step</span>
                <span>Price Drop %</span>
                <span>Buy % Capital</span>
                <span>Amount</span>
              </div>
              {buySteps.map((step, i) => (
                <div key={i} className="grid grid-cols-4 gap-2 items-center" data-testid={`buy-step-${i}`}>
                  <div className="flex items-center gap-1">
                    <Badge variant="secondary" className="text-[10px]">Buy {step.step}</Badge>
                    {i === 0 && <span className="text-[9px] text-muted-foreground">(first)</span>}
                  </div>
                  <Input
                    type="number"
                    value={step.dropPercent}
                    onChange={(e) => updateBuyStep(i, "dropPercent", Number(e.target.value))}
                    className="h-8 text-xs"
                    min="0"
                    step="1"
                    disabled={i === 0}
                    data-testid={`input-buy-drop-${i}`}
                  />
                  <Input
                    type="number"
                    value={step.percent}
                    onChange={(e) => updateBuyStep(i, "percent", Number(e.target.value))}
                    className="h-8 text-xs"
                    min="1"
                    max="100"
                    step="1"
                    data-testid={`input-buy-percent-${i}`}
                  />
                  <span className="text-xs font-mono text-muted-foreground">
                    ${(capital * step.percent / 100).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>

            {totalBuyPercent !== 100 && (
              <div className="text-[10px] text-[#f6465d] flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Buy percentages must total 100% (currently {totalBuyPercent}%)
              </div>
            )}
          </Card>

          <Card className="p-3 space-y-3">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <ArrowUp className="w-3 h-3 text-[#f6465d]" />
              Sell Steps (Profit Taking)
            </span>

            <div className="space-y-2">
              <div className="grid grid-cols-4 gap-2 text-[10px] text-muted-foreground uppercase tracking-wide px-1">
                <span>Step</span>
                <span>Rise % (avg)</span>
                <span>Sell % Position</span>
                <span>Target</span>
              </div>
              {sellSteps.map((step, i) => (
                <div key={i} className="grid grid-cols-4 gap-2 items-center" data-testid={`sell-step-${i}`}>
                  <Badge variant="secondary" className="text-[10px]">
                    {step.sellRemaining ? "Sell All" : `Sell ${step.step}`}
                  </Badge>
                  <Input
                    type="number"
                    value={step.risePercent}
                    onChange={(e) => updateSellStep(i, "risePercent", Number(e.target.value))}
                    className="h-8 text-xs"
                    min="1"
                    step="1"
                    data-testid={`input-sell-rise-${i}`}
                  />
                  <Input
                    type="number"
                    value={step.percent}
                    onChange={(e) => updateSellStep(i, "percent", Number(e.target.value))}
                    className="h-8 text-xs"
                    min="1"
                    max="100"
                    step="1"
                    disabled={step.sellRemaining}
                    data-testid={`input-sell-percent-${i}`}
                  />
                  <span className="text-xs font-mono text-muted-foreground">
                    {avgEntryPrice > 0 ? `$${(avgEntryPrice * (1 + step.risePercent / 100)).toLocaleString(undefined, { maximumFractionDigits: 4 })}` : "--"}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <button
            className="flex items-center gap-1 text-xs text-muted-foreground hover-elevate px-2 py-1 rounded-md"
            onClick={() => setShowAdvanced(!showAdvanced)}
            data-testid="button-toggle-advanced"
          >
            {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Risk Control Settings
          </button>

          {showAdvanced && (
            <Card className="p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-medium">Support Break Protection</div>
                  <div className="text-[10px] text-muted-foreground">If price breaks support with a daily close, stop all further buys. Only sell on bounce.</div>
                </div>
                <Switch
                  checked={supportBreakStop}
                  onCheckedChange={setSupportBreakStop}
                  data-testid="switch-support-break-stop"
                />
              </div>
              {selectedSupport > 0 && (
                <div className="text-[10px] text-muted-foreground">
                  Selected support: <span className="font-mono text-foreground">${selectedSupport.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                </div>
              )}
            </Card>
          )}

          {currentPrice > 0 && capital > 0 && (
            <Card className="p-3 space-y-2 bg-muted/30">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Calculation Summary</span>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="text-muted-foreground">Total Capital</div>
                <div className="font-mono text-right">${capital.toLocaleString()}</div>
                <div className="text-muted-foreground">Current Price</div>
                <div className="font-mono text-right">${currentPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}</div>
                <div className="text-muted-foreground">Avg Entry (if all buys)</div>
                <div className="font-mono text-right">${avgEntryPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}</div>
                <div className="text-muted-foreground">Max Buy Steps</div>
                <div className="font-mono text-right">{buySteps.length}</div>
                <div className="text-muted-foreground">Est. Total Profit</div>
                <div className={`font-mono text-right ${totalProfit >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>
                  ${totalProfit.toFixed(2)}
                </div>
              </div>

              {buyCalculations.length > 0 && (
                <div className="pt-2 border-t border-border mt-2">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Buy Order Preview</div>
                  {buyCalculations.map((b, i) => (
                    <div key={i} className="flex items-center justify-between text-[10px] py-0.5">
                      <span className="text-muted-foreground">Buy {b.step}: {b.dropPercent > 0 ? `-${b.dropPercent}%` : "Entry"}</span>
                      <span className="font-mono">
                        ${b.triggerPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })} | {b.qty.toFixed(6)} coins | ${b.amount.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {sellCalculations.length > 0 && avgEntryPrice > 0 && (
                <div className="pt-2 border-t border-border mt-2">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Sell Order Preview</div>
                  {sellCalculations.map((s, i) => (
                    <div key={i} className="flex items-center justify-between text-[10px] py-0.5">
                      <span className="text-muted-foreground">{s.sellRemaining ? "Sell All" : `Sell ${s.step}`}: +{s.risePercent}%</span>
                      <span className="font-mono">
                        ${s.triggerPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })} | {s.sellQty.toFixed(6)} coins | +${s.profit.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          <Button
            className="w-full bg-[#0ecb81] hover:bg-[#0ecb81]/90 text-black font-semibold"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || totalBuyPercent !== 100 || capital <= 0}
            data-testid="button-create-dca-bot"
          >
            {createMutation.isPending ? "Creating..." : "Create DCA Bot"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DcaBotDashboard({ bot, onBack }: { bot: AutopilotBot; onBack: () => void }) {
  const { toast } = useToast();
  let config: DcaConfig | null = null;
  try { config = JSON.parse(bot.strategyConfig || "{}"); } catch {}

  const { data: orders = [], isLoading: ordersLoading } = useQuery<DcaBotOrder[]>({
    queryKey: ["/api/dca/bots", bot.id, "orders"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/dca/bots/${bot.id}/orders`);
      return res.json();
    },
    refetchInterval: 5000,
  });

  const { data: priceData } = useQuery<{ price: number }>({
    queryKey: ["/api/dca/price", bot.symbol],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/dca/price/${bot.symbol}`);
      return res.json();
    },
    refetchInterval: 5000,
  });

  const currentPrice = priceData?.price || 0;

  const executedBuys = orders.filter(o => o.type === "buy");
  const executedSells = orders.filter(o => o.type === "sell");
  const totalCost = executedBuys.reduce((s, o) => s + o.total, 0);
  const totalBuyQty = executedBuys.reduce((s, o) => s + o.quantity, 0);
  const totalSoldQty = executedSells.reduce((s, o) => s + o.quantity, 0);
  const avgPrice = totalBuyQty > 0 ? totalCost / totalBuyQty : 0;
  const remainingQty = totalBuyQty - totalSoldQty;
  const unrealizedPnl = remainingQty * (currentPrice - avgPrice);
  const realizedPnl = executedSells.reduce((s, o) => s + (o.price - avgPrice) * o.quantity, 0);

  const buyMutation = useMutation({
    mutationFn: async ({ step, orderType }: { step: number; orderType: string }) => {
      const res = await apiRequest("POST", `/api/dca/bots/${bot.id}/execute-buy`, {
        step,
        price: currentPrice,
        orderType,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/dca/bots", bot.id, "orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/autopilot/bots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      toast({ title: "Buy Executed", description: `Step ${data.executedSteps} completed. Avg price: $${data.avgPrice.toFixed(4)}` });
    },
    onError: (err: any) => {
      toast({ title: "Buy Failed", description: err.message || "Failed to execute buy", variant: "destructive" });
    },
  });

  const sellMutation = useMutation({
    mutationFn: async ({ step, orderType }: { step: number; orderType: string }) => {
      const res = await apiRequest("POST", `/api/dca/bots/${bot.id}/execute-sell`, {
        step,
        price: currentPrice,
        orderType,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/dca/bots", bot.id, "orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/autopilot/bots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      toast({ title: "Sell Executed", description: `Sold ${data.soldQuantity.toFixed(6)} coins. PnL: $${data.pnl.toFixed(2)}` });
    },
    onError: (err: any) => {
      toast({ title: "Sell Failed", description: err.message || "Failed to execute sell", variant: "destructive" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/dca/bots/${bot.id}/reset`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dca/bots", bot.id, "orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/autopilot/bots"] });
      toast({ title: "Bot Reset", description: "All orders cleared. Ready for a fresh start." });
    },
  });

  const buySteps = config?.buySteps || DEFAULT_BUY_STEPS;
  const sellSteps = config?.sellSteps || DEFAULT_SELL_STEPS;
  const totalCapital = config?.totalCapital || bot.tradeAmount;

  const supportBroken = config?.riskControl?.supportBreakStop && config.supportPrice > 0 && currentPrice < config.supportPrice;

  const dashboardToggleMutation = useMutation({
    mutationFn: async (isActive: boolean) => {
      await apiRequest("POST", `/api/autopilot/bots/${bot.id}/toggle`, { isActive });
    },
    onSuccess: (_, isActive) => {
      queryClient.invalidateQueries({ queryKey: ["/api/autopilot/bots"] });
      if (isActive) {
        toast({ title: "Bot Started", description: "Auto-execution is now active. First buy will execute shortly." });
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["/api/dca/bots", bot.id, "orders"] });
          queryClient.invalidateQueries({ queryKey: ["/api/autopilot/bots"] });
          queryClient.invalidateQueries({ queryKey: ["/api/user"] });
        }, 2000);
      } else {
        toast({ title: "Bot Stopped", description: "Auto-execution paused." });
      }
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-back-to-bots">
            <ChevronDown className="w-4 h-4 rotate-90" />
            Back
          </Button>
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2" data-testid="text-dca-bot-name">
              <Bot className="w-5 h-5 text-[#0ecb81]" />
              {bot.name}
            </h2>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono text-muted-foreground">{bot.symbol.replace("USDT", "/USDT")}</span>
              <Badge variant={bot.isActive ? "default" : "secondary"} className={bot.isActive ? "bg-[#0ecb81]/20 text-[#0ecb81] border-[#0ecb81]/30" : ""}>
                {bot.isActive ? "Active" : "Stopped"}
              </Badge>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={bot.isActive ? "destructive" : "default"}
            size="sm"
            className={!bot.isActive ? "bg-[#0ecb81] text-white" : ""}
            onClick={() => dashboardToggleMutation.mutate(!bot.isActive)}
            disabled={dashboardToggleMutation.isPending}
            data-testid="button-start-stop-bot"
          >
            {dashboardToggleMutation.isPending ? (
              <RefreshCw className="w-4 h-4 animate-spin mr-1" />
            ) : bot.isActive ? (
              <AlertTriangle className="w-4 h-4 mr-1" />
            ) : (
              <Zap className="w-4 h-4 mr-1" />
            )}
            {bot.isActive ? "Stop Bot" : "Start Bot"}
          </Button>
          <Button variant="ghost" size="icon" onClick={() => resetMutation.mutate()} disabled={resetMutation.isPending} data-testid="button-reset-bot">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {supportBroken && (
        <Card className="p-3 border-[#f6465d]/30 bg-[#f6465d]/5">
          <div className="flex items-center gap-2 text-sm text-[#f6465d] font-medium">
            <AlertTriangle className="w-4 h-4" />
            Support Broken - Buys stopped. Only selling on bounces allowed.
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">
            Support: ${config?.supportPrice?.toLocaleString()} | Current: ${currentPrice.toLocaleString()}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Current Price</div>
          <div className="text-sm font-mono font-semibold mt-0.5" data-testid="text-dca-current-price">
            ${currentPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Avg Buy Price</div>
          <div className="text-sm font-mono font-semibold mt-0.5" data-testid="text-dca-avg-price">
            {avgPrice > 0 ? `$${avgPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}` : "--"}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Unrealized PnL</div>
          <div className={`text-sm font-mono font-semibold mt-0.5 ${unrealizedPnl >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]"}`} data-testid="text-dca-unrealized-pnl">
            {remainingQty > 0 ? `${unrealizedPnl >= 0 ? "+" : ""}$${unrealizedPnl.toFixed(2)}` : "--"}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Realized PnL</div>
          <div className={`text-sm font-mono font-semibold mt-0.5 ${realizedPnl >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]"}`} data-testid="text-dca-realized-pnl">
            {executedSells.length > 0 ? `${realizedPnl >= 0 ? "+" : ""}$${realizedPnl.toFixed(2)}` : "--"}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Total Invested</div>
          <div className="text-sm font-mono font-semibold mt-0.5">${totalCost.toFixed(2)}</div>
          <div className="text-[10px] text-muted-foreground">of ${totalCapital.toLocaleString()}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Total Qty</div>
          <div className="text-sm font-mono font-semibold mt-0.5">{totalBuyQty.toFixed(6)}</div>
          <div className="text-[10px] text-muted-foreground">Remaining: {remainingQty.toFixed(6)}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Buys / Sells</div>
          <div className="text-sm font-mono font-semibold mt-0.5">
            {executedBuys.length}/{buySteps.length} | {executedSells.length}/{sellSteps.length}
          </div>
        </Card>
      </div>

      <Tabs defaultValue="buy" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="buy" data-testid="tab-dca-buy">
            <ArrowDown className="w-3 h-3 mr-1" /> Buy Steps
          </TabsTrigger>
          <TabsTrigger value="sell" data-testid="tab-dca-sell">
            <ArrowUp className="w-3 h-3 mr-1" /> Sell Steps
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-dca-history">
            <Eye className="w-3 h-3 mr-1" /> History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="buy" className="space-y-2 mt-3">
          {buySteps.map((step, i) => {
            const executed = executedBuys.find(o => o.step === step.step);
            const firstBuy = executedBuys.find(o => o.step === 1);
            const entryPrice = firstBuy ? firstBuy.price : (config?.orderType === "limit" && config.limitPrice ? config.limitPrice : currentPrice);
            const triggerPrice = i === 0 ? (firstBuy ? firstBuy.price : entryPrice) : entryPrice * (1 - step.dropPercent / 100);
            const amount = totalCapital * (step.percent / 100);
            const maxReached = executedBuys.length >= (config?.maxBuySteps || 5);
            const canBuy = !executed && !maxReached && !supportBroken;

            return (
              <Card key={i} className={`p-3 ${executed ? "bg-[#0ecb81]/5 border-[#0ecb81]/20" : ""}`} data-testid={`card-buy-step-${i}`}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Badge variant={executed ? "default" : "secondary"} className={executed ? "bg-[#0ecb81]/20 text-[#0ecb81] border-[#0ecb81]/30" : ""}>
                      Buy {step.step}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {i === 0 ? "First Buy (Entry)" : `If price drops ${step.dropPercent}%`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {executed ? (
                      <Badge variant="secondary" className="text-[10px] text-[#0ecb81]">
                        Filled @ ${executed.price.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => buyMutation.mutate({ step: step.step, orderType: config?.orderType || "market" })}
                        disabled={!canBuy || buyMutation.isPending}
                        className="bg-[#0ecb81] hover:bg-[#0ecb81]/90 text-black text-xs"
                        data-testid={`button-execute-buy-${i}`}
                      >
                        {buyMutation.isPending ? "..." : "Execute Buy"}
                      </Button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 mt-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Trigger Price</span>
                    <div className="font-mono">${triggerPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Amount ({step.percent}%)</span>
                    <div className="font-mono">${amount.toFixed(2)}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Qty</span>
                    <div className="font-mono">{executed ? executed.quantity.toFixed(6) : triggerPrice > 0 ? (amount / triggerPrice).toFixed(6) : "--"}</div>
                  </div>
                </div>
              </Card>
            );
          })}
          {executedBuys.length >= (config?.maxBuySteps || 5) && (
            <div className="text-xs text-center text-muted-foreground py-2">
              Maximum buy steps reached ({config?.maxBuySteps || 5}). No further buying allowed.
            </div>
          )}
        </TabsContent>

        <TabsContent value="sell" className="space-y-2 mt-3">
          {executedBuys.length === 0 ? (
            <Card className="p-6 text-center">
              <div className="text-sm text-muted-foreground">Execute at least one buy step first before selling.</div>
            </Card>
          ) : (
            sellSteps.map((step, i) => {
              const executed = executedSells.find(o => o.step === step.step);
              const triggerPrice = avgPrice * (1 + step.risePercent / 100);
              const sellQty = step.sellRemaining ? remainingQty : totalBuyQty * (step.percent / 100);
              const canSell = !executed && remainingQty > 0;
              const priceAboveTarget = currentPrice >= triggerPrice;

              return (
                <Card key={i} className={`p-3 ${executed ? "bg-[#0ecb81]/5 border-[#0ecb81]/20" : ""}`} data-testid={`card-sell-step-${i}`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Badge variant={executed ? "default" : "secondary"} className={executed ? "bg-[#0ecb81]/20 text-[#0ecb81] border-[#0ecb81]/30" : ""}>
                        {step.sellRemaining ? "Sell All" : `Sell ${step.step}`}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        +{step.risePercent}% above avg ({step.sellRemaining ? "remaining" : `${step.percent}%`})
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {executed ? (
                        <Badge variant="secondary" className="text-[10px] text-[#0ecb81]">
                          Sold @ ${executed.price.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => sellMutation.mutate({ step: step.step, orderType: "market" })}
                          disabled={!canSell || sellMutation.isPending}
                          className="text-xs"
                          variant={priceAboveTarget ? "default" : "secondary"}
                          data-testid={`button-execute-sell-${i}`}
                        >
                          {sellMutation.isPending ? "..." : priceAboveTarget ? "Sell Now" : "Force Sell"}
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 mt-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Target Price</span>
                      <div className={`font-mono ${priceAboveTarget && !executed ? "text-[#0ecb81]" : ""}`}>
                        ${triggerPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Qty to Sell</span>
                      <div className="font-mono">{executed ? executed.quantity.toFixed(6) : sellQty.toFixed(6)}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Est. Profit</span>
                      <div className="font-mono text-[#0ecb81]">
                        {executed
                          ? `+$${((executed.price - avgPrice) * executed.quantity).toFixed(2)}`
                          : avgPrice > 0 ? `+$${((triggerPrice - avgPrice) * sellQty).toFixed(2)}` : "--"
                        }
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-3">
          {ordersLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-[#0ecb81] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : orders.length === 0 ? (
            <Card className="p-6 text-center">
              <div className="text-sm text-muted-foreground">No orders executed yet.</div>
            </Card>
          ) : (
            <div className="space-y-2">
              {orders.map((order) => (
                <Card key={order.id} className="p-3" data-testid={`card-order-${order.id}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className={`text-[10px] ${order.type === "buy" ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>
                        {order.type.toUpperCase()} Step {order.step}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {order.executedAt ? new Date(order.executedAt).toLocaleString() : "--"}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 mt-1.5 text-xs">
                    <div>
                      <span className="text-muted-foreground">Price</span>
                      <div className="font-mono">${order.price.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Qty</span>
                      <div className="font-mono">{order.quantity.toFixed(6)}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Total</span>
                      <div className="font-mono">${order.total.toFixed(2)}</div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BotCard({ bot, onSelect }: { bot: AutopilotBot; onSelect: (bot: AutopilotBot) => void }) {
  const { toast } = useToast();

  let config: any = {};
  try { config = JSON.parse(bot.strategyConfig || "{}"); } catch {}
  const isDca = config.strategy === "dca_spot";

  const { data: priceData } = useQuery<{ price: number }>({
    queryKey: [`/api/dca/price/${bot.symbol}`],
    refetchInterval: 3000,
    enabled: bot.isActive,
  });

  const { data: orders = [] } = useQuery<any[]>({
    queryKey: [`/api/dca/bots/${bot.id}/orders`],
    refetchInterval: 5000,
    enabled: bot.isActive,
  });

  const currentPrice = priceData?.price || 0;
  const buyOrders = orders.filter((o: any) => o.type === "buy" && o.status === "executed");
  const sellOrders = orders.filter((o: any) => o.type === "sell" && o.status === "executed");
  const totalBoughtQty = buyOrders.reduce((s: number, o: any) => s + o.quantity, 0);
  const totalSoldQty = sellOrders.reduce((s: number, o: any) => s + o.quantity, 0);
  const totalBoughtCost = buyOrders.reduce((s: number, o: any) => s + o.total, 0);
  const totalSoldRevenue = sellOrders.reduce((s: number, o: any) => s + o.total, 0);
  const holdingQty = totalBoughtQty - totalSoldQty;
  const holdingValue = holdingQty * currentPrice;
  const avgCost = totalBoughtQty > 0 ? totalBoughtCost / totalBoughtQty : 0;
  const realizedPnl = totalSoldRevenue - (avgCost * totalSoldQty);
  const unrealizedPnl = holdingQty > 0 ? holdingValue - (avgCost * holdingQty) : 0;
  const runningPnl = realizedPnl + unrealizedPnl;

  const toggleMutation = useMutation({
    mutationFn: async (isActive: boolean) => {
      await apiRequest("POST", `/api/autopilot/bots/${bot.id}/toggle`, { isActive });
    },
    onSuccess: (_, isActive) => {
      queryClient.invalidateQueries({ queryKey: ["/api/autopilot/bots"] });
      if (isActive) {
        toast({ title: "Bot Activated", description: "Bot is now running. First buy will execute automatically." });
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["/api/dca/bots", bot.id, "orders"] });
          queryClient.invalidateQueries({ queryKey: ["/api/autopilot/bots"] });
          queryClient.invalidateQueries({ queryKey: ["/api/user"] });
        }, 2000);
      } else {
        toast({ title: "Bot Stopped", description: "Auto-execution paused." });
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/autopilot/bots/${bot.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/autopilot/bots"] });
      toast({ title: "Bot Deleted", description: `${bot.name} has been removed.` });
    },
  });

  const displayPnl = bot.isActive && currentPrice > 0 ? runningPnl : bot.totalPnl;
  const pnlColor = displayPnl >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]";
  const pnlPercent = totalBoughtCost > 0 && currentPrice > 0
    ? ((runningPnl / totalBoughtCost) * 100)
    : 0;

  return (
    <Card className="p-4 hover-elevate cursor-pointer" onClick={() => onSelect(bot)} data-testid={`card-bot-${bot.id}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0 ${bot.isActive ? "bg-[#0ecb81]/15" : "bg-muted"}`}>
            <Bot className={`w-5 h-5 ${bot.isActive ? "text-[#0ecb81]" : "text-muted-foreground"}`} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm" data-testid={`text-bot-name-${bot.id}`}>{bot.name}</span>
              <Badge variant={bot.isActive ? "default" : "secondary"} className={bot.isActive ? "bg-[#0ecb81]/20 text-[#0ecb81] border-[#0ecb81]/30" : ""}>
                {bot.isActive ? "Running" : "Stopped"}
              </Badge>
              {isDca && <Badge variant="secondary" className="text-[10px]">DCA</Badge>}
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-xs text-muted-foreground font-mono">{bot.symbol.replace("USDT", "/USDT")}</span>
              {isDca && <span className="text-xs text-muted-foreground">${(config.totalCapital || bot.tradeAmount).toLocaleString()} capital</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <Switch
            checked={bot.isActive}
            onCheckedChange={(checked) => toggleMutation.mutate(checked)}
            data-testid={`switch-bot-toggle-${bot.id}`}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mt-4 pt-3 border-t border-border">
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Trades</div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono font-semibold" data-testid={`text-bot-trades-${bot.id}`}>{bot.totalTrades}</span>
            {bot.isActive && currentPrice > 0 && holdingQty > 0 && (
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${unrealizedPnl >= 0 ? "bg-[#0ecb81]/15 text-[#0ecb81]" : "bg-[#f6465d]/15 text-[#f6465d]"}`} data-testid={`text-bot-live-pnl-${bot.id}`}>
                {unrealizedPnl >= 0 ? "+" : ""}{unrealizedPnl.toFixed(2)}
              </span>
            )}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Running PNL</div>
          <div className={`text-sm font-mono font-semibold ${pnlColor}`} data-testid={`text-bot-pnl-${bot.id}`}>
            {displayPnl >= 0 ? "+" : ""}{displayPnl.toFixed(2)} USDT
          </div>
          {bot.isActive && currentPrice > 0 && totalBoughtCost > 0 && (
            <div className={`text-[10px] font-mono ${pnlPercent >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>
              {pnlPercent >= 0 ? "+" : ""}{pnlPercent.toFixed(2)}%
            </div>
          )}
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Strategy</div>
          <div className="text-sm">
            {isDca ? (
              <Badge variant="secondary" className="text-[10px] text-[#0ecb81]">DCA Spot</Badge>
            ) : (
              <span className="text-xs text-muted-foreground">Custom</span>
            )}
          </div>
        </div>
      </div>

      {bot.lastTradeAt && (
        <div className="text-[10px] text-muted-foreground mt-2">
          Last trade: {new Date(bot.lastTradeAt).toLocaleString()}
        </div>
      )}

      <div className="flex items-center justify-between gap-1 mt-3 pt-2 border-t border-border">
        <Button
          size="sm"
          variant="ghost"
          className="text-xs gap-1"
          onClick={(e) => { e.stopPropagation(); onSelect(bot); }}
          data-testid={`button-view-bot-${bot.id}`}
        >
          <Eye className="w-3 h-3" />
          View Dashboard
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(); }}
          disabled={deleteMutation.isPending}
          data-testid={`button-delete-bot-${bot.id}`}
        >
          <Trash2 className="w-4 h-4 text-[#f6465d]" />
        </Button>
      </div>
    </Card>
  );
}

export default function AutopilotPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedBot, setSelectedBot] = useState<AutopilotBot | null>(null);

  const { data: bots = [], isLoading } = useQuery<AutopilotBot[]>({
    queryKey: ["/api/autopilot/bots"],
  });

  const activeBots = bots.filter((b) => b.isActive);
  const totalPnl = bots.reduce((sum, b) => sum + b.totalPnl, 0);
  const totalTrades = bots.reduce((sum, b) => sum + b.totalTrades, 0);

  useEffect(() => {
    if (selectedBot) {
      const updated = bots.find(b => b.id === selectedBot.id);
      if (updated) setSelectedBot(updated);
    }
  }, [bots, selectedBot]);

  if (selectedBot) {
    return (
      <LayoutShell>
        <div className="max-w-4xl mx-auto p-4">
          <DcaBotDashboard bot={selectedBot} onBack={() => setSelectedBot(null)} />
        </div>
      </LayoutShell>
    );
  }

  return (
    <LayoutShell>
      <div className="max-w-4xl mx-auto p-4 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2" data-testid="text-autopilot-title">
              <Zap className="w-5 h-5 text-[#f0b90b]" />
              Autopilot
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">Create and manage your DCA trading bots</p>
          </div>
          <Button
            onClick={() => setCreateOpen(true)}
            className="bg-[#0ecb81] hover:bg-[#0ecb81]/90 text-black font-semibold gap-2"
            data-testid="button-new-bot"
          >
            <Plus className="w-4 h-4" />
            New DCA Bot
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Card className="p-3">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Active Bots</div>
            <div className="text-lg font-bold mt-0.5 flex items-center gap-2" data-testid="text-active-bots">
              <Activity className="w-4 h-4 text-[#0ecb81]" />
              {activeBots.length} / {bots.length}
            </div>
          </Card>
          <Card className="p-3">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Total Trades</div>
            <div className="text-lg font-bold mt-0.5 font-mono" data-testid="text-total-bot-trades">{totalTrades}</div>
          </Card>
          <Card className="p-3">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Total PNL</div>
            <div className={`text-lg font-bold mt-0.5 font-mono ${totalPnl >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]"}`} data-testid="text-total-bot-pnl">
              {totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(2)}
            </div>
          </Card>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-[#0ecb81] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : bots.length === 0 ? (
          <Card className="p-8 text-center">
            <Bot className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-40" />
            <h3 className="font-semibold text-sm">No bots yet</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
              Create your first DCA Spot Bot to automate your dollar-cost averaging strategy. Configure buy and sell steps with custom percentages.
            </p>
            <Button
              className="mt-4 bg-[#0ecb81] hover:bg-[#0ecb81]/90 text-black font-semibold gap-2"
              onClick={() => setCreateOpen(true)}
              data-testid="button-create-first-bot"
            >
              <Plus className="w-4 h-4" />
              Create Your First DCA Bot
            </Button>
          </Card>
        ) : (
          <div className="space-y-3">
            {bots.map((bot) => (
              <BotCard key={bot.id} bot={bot} onSelect={setSelectedBot} />
            ))}
          </div>
        )}

        <CreateDcaBotDialog open={createOpen} onOpenChange={setCreateOpen} />
      </div>
    </LayoutShell>
  );
}
