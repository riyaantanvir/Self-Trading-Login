import { usePortfolio, useTickers } from "@/hooks/use-trades";
import { LayoutShell } from "@/components/layout-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, TrendingUp, TrendingDown, Wallet } from "lucide-react";

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

  if (loadingPortfolio || loadingTickers) {
    return (
      <LayoutShell>
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="w-10 h-10 animate-spin text-[#0ecb81]" />
        </div>
      </LayoutShell>
    );
  }

  const tickerMap: Record<string, number> = {};
  if (tickers) {
    (tickers as Ticker[]).forEach((t) => {
      tickerMap[t.symbol] = parseFloat(t.lastPrice);
    });
  }

  const portfolioItems = (holdings as PortfolioItem[] || []).map((h) => {
    const currentPrice = tickerMap[h.symbol] || 0;
    const currentValue = h.quantity * currentPrice;
    const costBasis = h.quantity * h.avgBuyPrice;
    const pnl = currentValue - costBasis;
    const pnlPercent = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
    return { ...h, currentPrice, currentValue, pnl, pnlPercent };
  });

  const totalValue = portfolioItems.reduce((sum, i) => sum + i.currentValue, 0);
  const totalPnL = portfolioItems.reduce((sum, i) => sum + i.pnl, 0);

  return (
    <LayoutShell>
      <div className="p-4 md:p-6 max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold text-foreground mb-6" data-testid="text-page-title">Portfolio</h1>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
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

        <div className="rounded-md border border-border overflow-hidden bg-card">
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
                </tr>
              </thead>
              <tbody>
                {portfolioItems.length > 0 ? (
                  portfolioItems.map((item) => {
                    const coinName = item.symbol.replace("USDT", "");
                    return (
                      <tr key={item.id} className="border-b border-border/50" data-testid={`row-portfolio-${item.symbol}`}>
                        <td className="p-3">
                          <span className="font-semibold text-foreground">{coinName}</span>
                          <span className="text-xs text-muted-foreground">/USDT</span>
                        </td>
                        <td className="p-3 text-right font-mono text-foreground">{item.quantity.toFixed(6)}</td>
                        <td className="p-3 text-right font-mono text-muted-foreground">${item.avgBuyPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                        <td className="p-3 text-right font-mono text-foreground">${item.currentPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                        <td className="p-3 text-right font-mono font-semibold text-foreground">${item.currentValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td className="p-3 text-right">
                          <div className={`font-mono font-medium ${item.pnl >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>
                            {item.pnl >= 0 ? "+" : ""}${item.pnl.toFixed(2)}
                          </div>
                          <div className={`text-xs ${item.pnlPercent >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>
                            {item.pnlPercent >= 0 ? "+" : ""}{item.pnlPercent.toFixed(2)}%
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted-foreground">
                      No holdings yet. Buy some coins from the Market page to see them here.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </LayoutShell>
  );
}
