import { useState, useMemo } from "react";
import { usePortfolio, useTickers, useCreateTrade } from "@/hooks/use-trades";
import { useDemoRealMode } from "@/hooks/use-trading-mode";
import { LayoutShell } from "@/components/layout-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, TrendingUp, TrendingDown, Wallet } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface Ticker {
  symbol: string;
  lastPrice: string;
}

interface PortfolioItem {
  id: number;
  userId: number;
  symbol: string;
  quantity: number;
  avgBuyPrice: number;
}

export default function PortfolioPage() {
  const { data: holdings, isLoading: loadingPortfolio } = usePortfolio();
  const { data: tickers, isLoading: loadingTickers } = useTickers();
  const { isRealMode, effectiveBalance } = useDemoRealMode();
  const createTrade = useCreateTrade();

  const { data: krakenBalancesData } = useQuery<{ balances: { currency: string; available: number; balance: number; wallet: string }[] }>({
    queryKey: ["/api/kraken/balances"],
    enabled: isRealMode,
    refetchInterval: 15000,
  });
  const [sellTarget, setSellTarget] = useState<{
    symbol: string;
    coinName: string;
    quantity: number;
    currentPrice: number;
    currentValue: number;
  } | null>(null);

  const tickerMap = useMemo(() => {
    const map: Record<string, number> = {};
    if (tickers) {
      (tickers as Ticker[]).forEach((t) => {
        map[t.symbol] = parseFloat(t.lastPrice);
      });
    }
    return map;
  }, [tickers]);

  const krakenHoldings = useMemo(() => {
    if (!isRealMode || !krakenBalancesData?.balances) return [];
    return krakenBalancesData.balances
      .filter((b) => !["USDT", "USDC", "USD"].includes(b.currency) && b.balance > 0)
      .map((b) => {
        const symbol = `${b.currency}USDT`;
        const currentPrice = tickerMap[symbol] || 0;
        const currentValue = b.balance * currentPrice;
        return {
          id: 0,
          userId: 0,
          symbol,
          quantity: b.balance,
          avgBuyPrice: 0,
          currentPrice,
          currentValue,
          pnl: 0,
          pnlPercent: 0,
        };
      });
  }, [isRealMode, krakenBalancesData, tickerMap]);

  const portfolioItems = useMemo(() => {
    if (isRealMode) return krakenHoldings;
    return (holdings as PortfolioItem[] || []).map((h) => {
      const currentPrice = tickerMap[h.symbol] || 0;
      const currentValue = h.quantity * currentPrice;
      const costBasis = h.quantity * h.avgBuyPrice;
      const pnl = currentValue - costBasis;
      const pnlPercent = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
      return { ...h, currentPrice, currentValue, pnl, pnlPercent };
    });
  }, [isRealMode, krakenHoldings, holdings, tickerMap]);

  const totalValue = portfolioItems.reduce((sum, i) => sum + i.currentValue, 0) + (isRealMode ? effectiveBalance : 0);
  const totalPnL = portfolioItems.reduce((sum, i) => sum + i.pnl, 0);

  if (loadingPortfolio || loadingTickers) {
    return (
      <LayoutShell>
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="w-10 h-10 animate-spin text-[#0ecb81]" />
        </div>
      </LayoutShell>
    );
  }

  const handleSellAll = () => {
    if (!sellTarget) return;
    createTrade.mutate(
      {
        symbol: sellTarget.symbol,
        type: "sell",
        quantity: sellTarget.quantity,
        price: sellTarget.currentPrice,
      },
      {
        onSettled: () => {
          setSellTarget(null);
        },
      }
    );
  };

  return (
    <LayoutShell>
      <div className="p-4 md:p-6 max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold text-foreground mb-6" data-testid="text-page-title">Portfolio</h1>

        <div className={`grid grid-cols-1 ${isRealMode ? "md:grid-cols-2" : "md:grid-cols-3"} gap-4 mb-6`}>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Value</CardTitle>
              <Wallet className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono" data-testid="text-total-value">
                ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </CardContent>
          </Card>
          {!isRealMode && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total P&L</CardTitle>
              {totalPnL >= 0 ? <TrendingUp className="w-4 h-4 text-[#0ecb81]" /> : <TrendingDown className="w-4 h-4 text-[#f6465d]" />}
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold font-mono ${totalPnL >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]"}`} data-testid="text-total-pnl">
                {totalPnL >= 0 ? "+" : ""}${totalPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </CardContent>
          </Card>
          )}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Holdings</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono" data-testid="text-holdings-count">
                {portfolioItems.length}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="hidden md:block rounded-md border border-border overflow-hidden bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left p-3 text-xs text-muted-foreground font-medium">Asset</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">Quantity</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">Avg. Buy</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">Current</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">Value</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">P&L</th>
                  <th className="text-center p-3 text-xs text-muted-foreground font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {portfolioItems.length > 0 ? (
                  portfolioItems.map((item) => {
                    const coinName = item.symbol.replace("USDT", "");
                    return (
                      <tr key={item.symbol} className="border-b border-border/50" data-testid={`row-portfolio-${item.symbol}`}>
                        <td className="p-3">
                          <span className="font-semibold text-foreground">{coinName}</span>
                          <span className="text-xs text-muted-foreground">/{isRealMode ? "USD" : "USDT"}</span>
                        </td>
                        <td className="p-3 text-right font-mono text-foreground">{item.quantity.toFixed(6)}</td>
                        <td className="p-3 text-right font-mono text-muted-foreground">
                          {item.avgBuyPrice > 0 
                            ? `$${item.avgBuyPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}` 
                            : "--"}
                        </td>
                        <td className="p-3 text-right font-mono text-foreground">${item.currentPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                        <td className="p-3 text-right font-mono font-semibold text-foreground">${item.currentValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td className="p-3 text-right">
                          {item.avgBuyPrice > 0 ? (
                            <>
                              <div className={`font-mono font-medium ${item.pnl >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>
                                {item.pnl >= 0 ? "+" : ""}${item.pnl.toFixed(2)}
                              </div>
                              <div className={`text-xs ${item.pnlPercent >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>
                                {item.pnlPercent >= 0 ? "+" : ""}{item.pnlPercent.toFixed(2)}%
                              </div>
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">--</span>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          {item.quantity > 0 ? (
                            <Button
                              size="sm"
                              variant="destructive"
                              data-testid={`button-sell-all-${item.symbol}`}
                              onClick={() =>
                                setSellTarget({
                                  symbol: item.symbol,
                                  coinName,
                                  quantity: item.quantity,
                                  currentPrice: item.currentPrice,
                                  currentValue: item.currentValue,
                                })
                              }
                            >
                              Sell All
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">--</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      No holdings yet. Buy some coins from the Market page to see them here.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="md:hidden space-y-2">
          {portfolioItems.length > 0 ? (
            portfolioItems.map((item) => {
              const coinName = item.symbol.replace("USDT", "");
              return (
                <div
                  key={item.symbol}
                  className="rounded-md border border-border bg-card p-3"
                  data-testid={`card-portfolio-${item.symbol}`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div>
                      <span className="font-semibold text-foreground">{coinName}</span>
                      <span className="text-xs text-muted-foreground">/{isRealMode ? "USD" : "USDT"}</span>
                    </div>
                    {!isRealMode && (
                    <div className={`font-mono text-sm font-semibold ${item.pnl >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>
                      {item.pnl >= 0 ? "+" : ""}{item.pnlPercent.toFixed(2)}%
                    </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-2">
                    <div className="flex justify-between gap-1">
                      <span className="text-muted-foreground">Qty</span>
                      <span className="font-mono text-foreground">{item.quantity.toFixed(6)}</span>
                    </div>
                    <div className="flex justify-between gap-1">
                      <span className="text-muted-foreground">Value</span>
                      <span className="font-mono font-semibold text-foreground">${item.currentValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    {!isRealMode && (
                    <>
                    <div className="flex justify-between gap-1">
                      <span className="text-muted-foreground">Avg Buy</span>
                      <span className="font-mono text-muted-foreground">${item.avgBuyPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
                    </div>
                    <div className="flex justify-between gap-1">
                      <span className="text-muted-foreground">P&L</span>
                      <span className={`font-mono ${item.pnl >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>
                        {item.pnl >= 0 ? "+" : ""}${item.pnl.toFixed(2)}
                      </span>
                    </div>
                    </>
                    )}
                  </div>
                  {item.quantity > 0 && (
                    <Button
                      size="sm"
                      variant="destructive"
                      className="w-full text-xs"
                      data-testid={`button-sell-all-mobile-${item.symbol}`}
                      onClick={() =>
                        setSellTarget({
                          symbol: item.symbol,
                          coinName,
                          quantity: item.quantity,
                          currentPrice: item.currentPrice,
                          currentValue: item.currentValue,
                        })
                      }
                    >
                      Sell All
                    </Button>
                  )}
                </div>
              );
            })
          ) : (
            <div className="p-8 text-center text-muted-foreground text-sm">
              No holdings yet. Buy some coins from the Market page to see them here.
            </div>
          )}
        </div>
      </div>

      <Dialog open={!!sellTarget} onOpenChange={(open) => !open && setSellTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Sell All</DialogTitle>
            <DialogDescription>
              {sellTarget && (
                <>
                  You are about to sell all your <span className="font-semibold text-foreground">{sellTarget.coinName}/USDT</span> holdings.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {sellTarget && (
            <div className="space-y-2 py-2">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">Quantity</span>
                <span className="font-mono font-medium text-foreground">{sellTarget.quantity.toFixed(6)} {sellTarget.coinName}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">Market Price</span>
                <span className="font-mono font-medium text-foreground">${sellTarget.currentPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-sm border-t border-border pt-2">
                <span className="text-muted-foreground">Estimated Value</span>
                <span className="font-mono font-semibold text-foreground">${sellTarget.currentValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSellTarget(null)} data-testid="button-cancel-sell">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleSellAll}
              disabled={createTrade.isPending}
              data-testid="button-confirm-sell"
            >
              {createTrade.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              Sell All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </LayoutShell>
  );
}
