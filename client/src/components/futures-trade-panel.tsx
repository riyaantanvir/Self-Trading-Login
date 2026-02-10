import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, TrendingDown, ArrowLeftRight, X } from "lucide-react";

interface FuturesWallet {
  id: number;
  userId: number;
  balance: number;
}

interface FuturesPosition {
  id: number;
  symbol: string;
  side: "long" | "short";
  quantity: number;
  entryPrice: number;
  leverage: number;
  marginMode: "cross" | "isolated";
  isolatedMargin: number;
  liquidationPrice: number;
  status: string;
  openedAt: string;
}

interface FuturesTradePanelProps {
  symbol: string;
  currentPrice: number;
}

const LEVERAGE_OPTIONS = [1, 2, 3, 5, 10, 20, 50, 75, 100, 125];
const FEE_RATE = 0.0004;

function formatPrice(price: number) {
  if (price >= 1000) return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(8);
}

export function FuturesTradePanel({ symbol, currentPrice }: FuturesTradePanelProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const coinName = symbol.replace("USDT", "");

  const [side, setSide] = useState<"long" | "short">("long");
  const [marginMode, setMarginMode] = useState<"cross" | "isolated">("cross");
  const [leverage, setLeverage] = useState(10);
  const [leverageOpen, setLeverageOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [sliderValue, setSliderValue] = useState(0);

  const [transferAmount, setTransferAmount] = useState("");
  const [transferDirection, setTransferDirection] = useState<"spot_to_futures" | "futures_to_spot">("spot_to_futures");
  const [showTransfer, setShowTransfer] = useState(false);

  const { data: wallet, isLoading: walletLoading } = useQuery<FuturesWallet>({
    queryKey: ["/api/futures/wallet"],
  });

  const { data: positions, isLoading: positionsLoading } = useQuery<FuturesPosition[]>({
    queryKey: ["/api/futures/positions"],
  });

  const openPositionMutation = useMutation({
    mutationFn: async (data: {
      symbol: string;
      side: "long" | "short";
      quantity: number;
      leverage: number;
      marginMode: "cross" | "isolated";
      price: number;
    }) => {
      const res = await apiRequest("POST", "/api/futures/positions/open", data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/futures/wallet"] });
      queryClient.invalidateQueries({ queryKey: ["/api/futures/positions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/futures/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      setAmount("");
      setSliderValue(0);
      toast({ title: "Position Opened", description: `${side.toUpperCase()} ${coinName}/USDT ${leverage}x` });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to open position", description: error.message, variant: "destructive" });
    },
  });

  const closePositionMutation = useMutation({
    mutationFn: async (data: { positionId: number; quantity?: number }) => {
      const res = await apiRequest("POST", "/api/futures/positions/close", data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/futures/wallet"] });
      queryClient.invalidateQueries({ queryKey: ["/api/futures/positions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/futures/trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      toast({ title: "Position Closed" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to close position", description: error.message, variant: "destructive" });
    },
  });

  const transferMutation = useMutation({
    mutationFn: async (data: { amount: number; direction: string }) => {
      const res = await apiRequest("POST", "/api/futures/wallet/transfer", data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/futures/wallet"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      setTransferAmount("");
      toast({ title: "Transfer Complete" });
    },
    onError: (error: Error) => {
      toast({ title: "Transfer Failed", description: error.message, variant: "destructive" });
    },
  });

  const availableBalance = wallet?.balance ?? 0;
  const spotBalance = user ? Number(user.balance) : 0;
  const numAmount = Number(amount) || 0;
  const notionalValue = numAmount * leverage;
  const marginRequired = numAmount;
  const fees = notionalValue * FEE_RATE;
  const tokenQty = currentPrice > 0 ? notionalValue / currentPrice : 0;

  const symbolPositions = (positions ?? []).filter((p) => p.symbol === symbol);

  function handlePercentClick(pct: number) {
    const usdtAmt = availableBalance * (pct / 100);
    setAmount(usdtAmt.toFixed(2));
    setSliderValue(pct);
  }

  function handleSliderChange(val: number) {
    setSliderValue(val);
    const usdtAmt = availableBalance * (val / 100);
    setAmount(usdtAmt.toFixed(2));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (numAmount <= 0 || currentPrice <= 0) return;

    openPositionMutation.mutate({
      symbol,
      side,
      quantity: parseFloat(tokenQty.toFixed(8)),
      leverage,
      marginMode,
      price: currentPrice,
    });
  }

  function handleTransfer(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(transferAmount);
    if (amt <= 0) return;
    transferMutation.mutate({ amount: amt, direction: transferDirection });
  }

  function handleSideChange(newSide: "long" | "short") {
    setSide(newSide);
    setAmount("");
    setSliderValue(0);
  }

  function computeROE(position: FuturesPosition) {
    const priceDiff = side === "long"
      ? currentPrice - position.entryPrice
      : position.entryPrice - currentPrice;
    const pnl = priceDiff * position.quantity;
    const margin = position.isolatedMargin || (position.entryPrice * position.quantity / position.leverage);
    return margin > 0 ? (pnl / margin) * 100 : 0;
  }

  function computeUnrealizedPnl(position: FuturesPosition) {
    const priceDiff = position.side === "long"
      ? currentPrice - position.entryPrice
      : position.entryPrice - currentPrice;
    return priceDiff * position.quantity;
  }

  return (
    <div data-testid="futures-trade-panel">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
        <span className="text-xs text-muted-foreground font-medium">Futures</span>
        <button
          type="button"
          className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer"
          onClick={() => setShowTransfer(!showTransfer)}
          data-testid="button-toggle-transfer"
        >
          <ArrowLeftRight className="w-3 h-3" /> Transfer
        </button>
      </div>

      {showTransfer && (
        <div className="p-3 border-b border-border space-y-2">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Spot: <span className="text-foreground font-mono">{spotBalance.toFixed(2)} USDT</span></span>
            <span>Futures: <span className="text-foreground font-mono">{availableBalance.toFixed(2)} USDT</span></span>
          </div>
          <form onSubmit={handleTransfer} className="space-y-2">
            <div className="flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={`flex-1 text-[10px] toggle-elevate ${transferDirection === "spot_to_futures" ? "toggle-elevated bg-[#f0b90b]/20 text-[#f0b90b]" : ""}`}
                onClick={() => setTransferDirection("spot_to_futures")}
                data-testid="button-transfer-spot-to-futures"
              >
                Spot → Futures
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={`flex-1 text-[10px] toggle-elevate ${transferDirection === "futures_to_spot" ? "toggle-elevated bg-[#f0b90b]/20 text-[#f0b90b]" : ""}`}
                onClick={() => setTransferDirection("futures_to_spot")}
                data-testid="button-transfer-futures-to-spot"
              >
                Futures → Spot
              </Button>
            </div>
            <div className="flex gap-1">
              <Input
                type="number"
                step="any"
                min="0"
                value={transferAmount}
                onChange={(e) => setTransferAmount(e.target.value)}
                placeholder="Amount USDT"
                className="font-mono text-xs bg-background/50 border-border flex-1"
                data-testid="input-transfer-amount"
              />
              <Button
                type="submit"
                size="sm"
                disabled={transferMutation.isPending || Number(transferAmount) <= 0}
                className="text-xs bg-[#f0b90b] text-black border-[#f0b90b]"
                data-testid="button-submit-transfer"
              >
                {transferMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Transfer"}
              </Button>
            </div>
          </form>
        </div>
      )}

      <div className="p-3 space-y-3">
        <div className="flex gap-1">
          <Button
            variant={side === "long" ? "default" : "ghost"}
            size="sm"
            className={`flex-1 text-xs toggle-elevate ${side === "long" ? "toggle-elevated bg-[#0ecb81] text-white border-[#0ecb81]" : ""}`}
            onClick={() => handleSideChange("long")}
            data-testid="button-long-tab"
          >
            <TrendingUp className="w-3 h-3 mr-1" /> Long
          </Button>
          <Button
            variant={side === "short" ? "destructive" : "ghost"}
            size="sm"
            className={`flex-1 text-xs toggle-elevate ${side === "short" ? "toggle-elevated bg-[#f6465d] text-white border-[#f6465d]" : ""}`}
            onClick={() => handleSideChange("short")}
            data-testid="button-short-tab"
          >
            <TrendingDown className="w-3 h-3 mr-1" /> Short
          </Button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={`text-[10px] toggle-elevate ${marginMode === "cross" ? "toggle-elevated bg-foreground/10" : ""}`}
              onClick={() => setMarginMode("cross")}
              data-testid="button-margin-cross"
            >
              Cross
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={`text-[10px] toggle-elevate ${marginMode === "isolated" ? "toggle-elevated bg-foreground/10" : ""}`}
              onClick={() => setMarginMode("isolated")}
              data-testid="button-margin-isolated"
            >
              Isolated
            </Button>
          </div>
          <div className="relative">
            <button
              type="button"
              className="flex items-center gap-1 text-xs font-mono text-[#f0b90b] cursor-pointer"
              onClick={() => setLeverageOpen(!leverageOpen)}
              data-testid="button-leverage-dropdown"
            >
              {leverage}x
            </button>
            {leverageOpen && (
              <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-md shadow-lg z-50 min-w-[80px] max-h-[200px] overflow-y-auto">
                {LEVERAGE_OPTIONS.map((lev) => (
                  <button
                    key={lev}
                    type="button"
                    className={`block w-full text-left px-3 py-1.5 text-xs font-mono hover-elevate ${leverage === lev ? "text-[#f0b90b] font-medium" : "text-muted-foreground"}`}
                    onClick={() => { setLeverage(lev); setLeverageOpen(false); }}
                    data-testid={`button-leverage-${lev}`}
                  >
                    {lev}x
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="text-[10px] text-muted-foreground mb-0.5 block">Price</label>
          <Input
            value={`${formatPrice(currentPrice)}`}
            disabled
            className="font-mono text-xs bg-background/50 border-border"
            data-testid="input-futures-price"
          />
        </div>

        <form onSubmit={handleSubmit} className="space-y-2">
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <label className="text-[10px] text-muted-foreground">Margin (USDT)</label>
              <span className="text-[10px] text-muted-foreground">
                Avbl: <span className="font-mono text-foreground" data-testid="text-futures-available">{availableBalance.toFixed(2)}</span> USDT
              </span>
            </div>
            <Input
              type="number"
              step="any"
              min="0"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setSliderValue(0); }}
              placeholder="Margin amount in USDT"
              className="font-mono text-xs bg-background/50 border-border"
              data-testid="input-futures-amount"
            />
          </div>

          <div className="relative px-1">
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={sliderValue}
              onChange={(e) => handleSliderChange(Number(e.target.value))}
              className="w-full h-1 appearance-none rounded-full cursor-pointer"
              style={{
                background: `linear-gradient(to right, ${side === "long" ? "#0ecb81" : "#f6465d"} ${sliderValue}%, hsl(220, 10%, 20%) ${sliderValue}%)`,
              }}
              data-testid="slider-futures-amount"
            />
            <div className="flex justify-between mt-1">
              {[0, 25, 50, 75, 100].map((mark) => (
                <button
                  key={mark}
                  type="button"
                  className={`w-2 h-2 rounded-full border transition-colors ${
                    sliderValue >= mark
                      ? side === "long" ? "bg-[#0ecb81] border-[#0ecb81]" : "bg-[#f6465d] border-[#f6465d]"
                      : "bg-background border-border"
                  }`}
                  onClick={() => handlePercentClick(mark)}
                  data-testid={`button-futures-slider-${mark}`}
                />
              ))}
            </div>
          </div>

          {numAmount > 0 && (
            <div className="space-y-1 text-xs py-1 border-t border-border">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Notional Value</span>
                <span className="font-mono text-foreground" data-testid="text-notional-value">
                  {notionalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Size ({coinName})</span>
                <span className="font-mono text-foreground" data-testid="text-position-size">
                  {tokenQty.toFixed(6)} {coinName}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Margin Required</span>
                <span className="font-mono text-foreground" data-testid="text-margin-required">
                  {marginRequired.toFixed(2)} USDT
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Fees (0.04%)</span>
                <span className="font-mono text-foreground" data-testid="text-fees">
                  {fees.toFixed(4)} USDT
                </span>
              </div>
            </div>
          )}

          <Button
            type="submit"
            disabled={openPositionMutation.isPending || numAmount <= 0 || currentPrice <= 0}
            className={`w-full text-xs font-bold text-white ${
              side === "long"
                ? "bg-[#0ecb81] border-[#0ecb81]"
                : "bg-[#f6465d] border-[#f6465d]"
            }`}
            data-testid="button-submit-futures"
          >
            {openPositionMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              `${side === "long" ? "Long" : "Short"} ${coinName} ${leverage}x`
            )}
          </Button>
        </form>

        {symbolPositions.length > 0 && (
          <div className="border-t border-border pt-2">
            <div className="text-[10px] text-muted-foreground font-medium mb-1">
              Open Positions ({symbolPositions.length})
            </div>
            <div className="space-y-1.5">
              {symbolPositions.map((position) => {
                const pnl = computeUnrealizedPnl(position);
                const margin = position.isolatedMargin || (position.entryPrice * position.quantity / position.leverage);
                const roe = margin > 0 ? (pnl / margin) * 100 : 0;
                const isPnlPositive = pnl >= 0;

                return (
                  <div key={position.id} className="bg-background/50 rounded-md px-2 py-1.5 space-y-1" data-testid={`position-card-${position.id}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <span className={`text-[10px] font-medium ${position.side === "long" ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>
                          {position.side.toUpperCase()}
                        </span>
                        <Badge variant="outline" className="text-[8px] px-1 py-0">
                          {position.leverage}x
                        </Badge>
                        <Badge variant="outline" className="text-[8px] px-1 py-0">
                          {position.marginMode}
                        </Badge>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => closePositionMutation.mutate({ positionId: position.id })}
                        disabled={closePositionMutation.isPending}
                        data-testid={`button-close-position-${position.id}`}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
                      <div className="flex justify-between gap-1">
                        <span className="text-muted-foreground">Entry</span>
                        <span className="font-mono text-foreground">${formatPrice(position.entryPrice)}</span>
                      </div>
                      <div className="flex justify-between gap-1">
                        <span className="text-muted-foreground">Size</span>
                        <span className="font-mono text-foreground">{Number(position.quantity).toFixed(6)}</span>
                      </div>
                      <div className="flex justify-between gap-1">
                        <span className="text-muted-foreground">Liq. Price</span>
                        <span className="font-mono text-[#f0b90b]">
                          ${position.liquidationPrice ? formatPrice(Number(position.liquidationPrice)) : "N/A"}
                        </span>
                      </div>
                      <div className="flex justify-between gap-1">
                        <span className="text-muted-foreground">Margin</span>
                        <span className="font-mono text-foreground">{margin.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between gap-1">
                        <span className="text-muted-foreground">PnL</span>
                        <span className={`font-mono font-medium ${isPnlPositive ? "text-[#0ecb81]" : "text-[#f6465d]"}`} data-testid={`text-pnl-${position.id}`}>
                          {isPnlPositive ? "+" : ""}{pnl.toFixed(2)} USDT
                        </span>
                      </div>
                      <div className="flex justify-between gap-1">
                        <span className="text-muted-foreground">ROE</span>
                        <span className={`font-mono font-medium ${isPnlPositive ? "text-[#0ecb81]" : "text-[#f6465d]"}`} data-testid={`text-roe-${position.id}`}>
                          {isPnlPositive ? "+" : ""}{roe.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {walletLoading && (
          <div className="flex items-center justify-center py-2">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
    </div>
  );
}
