import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { LayoutShell } from "@/components/layout-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  ArrowLeft,
  TrendingUp,
  TrendingDown,
} from "lucide-react";

interface FuturesTrade {
  id: number;
  userId: number;
  symbol: string;
  side: string;
  action: string;
  quantity: number;
  price: number;
  leverage: number;
  marginMode: string;
  realizedPnl: number;
  fee: number;
  fundingFee: number;
  positionId: number | null;
  closePrice: number | null;
  timestamp: string;
}

export default function FuturesHistoryPage() {
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState<"all" | "open" | "close">("all");

  const { data: tradesData, isLoading } = useQuery<FuturesTrade[]>({
    queryKey: ["/api/futures/trades"],
  });

  const trades = useMemo(() => {
    const all = (tradesData ?? []) as FuturesTrade[];
    if (filter === "all") return all;
    return all.filter((t) => t.action === filter);
  }, [tradesData, filter]);

  const groupedByPosition = useMemo(() => {
    const groups: Record<number, { open: FuturesTrade | null; close: FuturesTrade | null }> = {};
    for (const t of (tradesData ?? []) as FuturesTrade[]) {
      const pid = t.positionId ?? t.id;
      if (!groups[pid]) groups[pid] = { open: null, close: null };
      if (t.action === "open") groups[pid].open = t;
      if (t.action === "close") groups[pid].close = t;
    }
    return groups;
  }, [tradesData]);

  const summary = useMemo(() => {
    const closeTrades = ((tradesData ?? []) as FuturesTrade[]).filter((t) => t.action === "close");
    const totalPnl = closeTrades.reduce((s, t) => s + t.realizedPnl, 0);
    const totalFees = closeTrades.reduce((s, t) => s + t.fee, 0);
    const totalFunding = closeTrades.reduce((s, t) => s + (t.fundingFee || 0), 0);
    const wins = closeTrades.filter((t) => t.realizedPnl > 0).length;
    const losses = closeTrades.filter((t) => t.realizedPnl < 0).length;
    return { totalPnl, totalFees, totalFunding, wins, losses, total: closeTrades.length };
  }, [tradesData]);

  if (isLoading) {
    return (
      <LayoutShell>
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="w-10 h-10 animate-spin text-[#f0b90b]" />
        </div>
      </LayoutShell>
    );
  }

  return (
    <LayoutShell>
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => navigate("/assets")}
            data-testid="button-back-assets"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-xl font-bold text-foreground">Futures Trade History</h1>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="rounded-md border border-border bg-card p-3">
            <div className="text-[10px] text-muted-foreground mb-0.5">Total P&L</div>
            <div className={`font-mono text-sm font-semibold ${summary.totalPnl >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]"}`} data-testid="text-futures-total-pnl">
              {summary.totalPnl >= 0 ? "+" : ""}{summary.totalPnl.toFixed(2)} USDT
            </div>
          </div>
          <div className="rounded-md border border-border bg-card p-3">
            <div className="text-[10px] text-muted-foreground mb-0.5">Trading Fees</div>
            <div className="font-mono text-sm font-semibold text-[#f6465d]" data-testid="text-futures-total-fees">
              -{summary.totalFees.toFixed(2)} USDT
            </div>
          </div>
          <div className="rounded-md border border-border bg-card p-3">
            <div className="text-[10px] text-muted-foreground mb-0.5">Funding Fees</div>
            <div className="font-mono text-sm font-semibold text-[#f6465d]" data-testid="text-futures-total-funding">
              -{summary.totalFunding.toFixed(2)} USDT
            </div>
          </div>
          <div className="rounded-md border border-border bg-card p-3">
            <div className="text-[10px] text-muted-foreground mb-0.5">Win / Loss</div>
            <div className="font-mono text-sm font-semibold text-foreground" data-testid="text-futures-win-loss">
              <span className="text-[#0ecb81]">{summary.wins}W</span> / <span className="text-[#f6465d]">{summary.losses}L</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-4">
          {(["all", "open", "close"] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "outline"}
              onClick={() => setFilter(f)}
              data-testid={`button-filter-${f}`}
            >
              {f === "all" ? "All" : f === "open" ? "Opens" : "Closes"}
            </Button>
          ))}
        </div>

        {trades.length === 0 ? (
          <div className="text-center text-muted-foreground py-12 text-sm">
            No futures trades yet.
          </div>
        ) : (
          <div className="space-y-3">
            {trades.map((trade) => {
              const coinName = trade.symbol.replace("USDT", "");
              const isOpen = trade.action === "open";
              const isLong = trade.side === "long";
              const notional = trade.quantity * trade.price;
              const paired = trade.positionId ? groupedByPosition[trade.positionId] : null;
              const netPnl = isOpen ? null : (trade.realizedPnl - trade.fee - (trade.fundingFee || 0));

              return (
                <div
                  key={trade.id}
                  className="rounded-md border border-border bg-card p-4"
                  data-testid={`card-futures-trade-${trade.id}`}
                >
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-foreground">{coinName}/USDT</span>
                      <Badge
                        variant="outline"
                        className={isLong ? "border-[#0ecb81] text-[#0ecb81]" : "border-[#f6465d] text-[#f6465d]"}
                      >
                        {isLong ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                        {trade.side.toUpperCase()}
                      </Badge>
                      <Badge variant="outline">
                        {trade.leverage}x
                      </Badge>
                      <Badge
                        variant={isOpen ? "default" : "secondary"}
                        className={isOpen ? "bg-[#0ecb81]/20 text-[#0ecb81] border-[#0ecb81]/30" : "bg-[#f0b90b]/20 text-[#f0b90b] border-[#f0b90b]/30"}
                      >
                        {isOpen ? "OPEN" : "CLOSE"}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">{trade.marginMode}</span>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-[10px] text-muted-foreground">
                        {new Date(trade.timestamp).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 mt-3 text-xs">
                    {isOpen ? (
                      <>
                        <div>
                          <span className="text-muted-foreground">Entry Price: </span>
                          <span className="font-mono text-foreground">${trade.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Size: </span>
                          <span className="font-mono text-foreground">{trade.quantity.toFixed(6)} {coinName}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Notional: </span>
                          <span className="font-mono text-foreground">${notional.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Margin: </span>
                          <span className="font-mono text-foreground">${(notional / trade.leverage).toFixed(2)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Trading Fee (0.04%): </span>
                          <span className="font-mono text-[#f6465d]">-${trade.fee.toFixed(4)}</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <span className="text-muted-foreground">Entry Price: </span>
                          <span className="font-mono text-foreground">${trade.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Close Price: </span>
                          <span className="font-mono text-foreground">${(trade.closePrice ?? trade.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Size: </span>
                          <span className="font-mono text-foreground">{trade.quantity.toFixed(6)} {coinName}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Realized P&L: </span>
                          <span className={`font-mono font-semibold ${trade.realizedPnl >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>
                            {trade.realizedPnl >= 0 ? "+" : ""}{trade.realizedPnl.toFixed(4)} USDT
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Trading Fee (0.04%): </span>
                          <span className="font-mono text-[#f6465d]">-{trade.fee.toFixed(4)} USDT</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Funding Fee (0.01%/8h): </span>
                          <span className="font-mono text-[#f6465d]">-{(trade.fundingFee || 0).toFixed(4)} USDT</span>
                        </div>
                      </>
                    )}
                  </div>

                  {!isOpen && netPnl !== null && (
                    <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
                      <span className="text-xs text-muted-foreground font-semibold">Net P&L (after all fees)</span>
                      <span className={`font-mono font-bold text-sm ${netPnl >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]"}`} data-testid={`text-net-pnl-${trade.id}`}>
                        {netPnl >= 0 ? "+" : ""}{netPnl.toFixed(4)} USDT
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </LayoutShell>
  );
}
