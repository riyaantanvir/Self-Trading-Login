import { useTrades } from "@/hooks/use-trades";
import { LayoutShell } from "@/components/layout-shell";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, TrendingDown } from "lucide-react";
import { format } from "date-fns";

interface Trade {
  id: number;
  symbol: string;
  type: string;
  quantity: number;
  price: number;
  total: number;
  status: string;
  timestamp: string;
}

export default function HistoryPage() {
  const { data: trades, isLoading } = useTrades();

  if (isLoading) {
    return (
      <LayoutShell>
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="w-10 h-10 animate-spin text-[#0ecb81]" />
        </div>
      </LayoutShell>
    );
  }

  const tradeList = (trades as Trade[] || []).slice().sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return (
    <LayoutShell>
      <div className="p-4 md:p-6 max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold text-foreground mb-6" data-testid="text-page-title">Trade History</h1>

        <div className="hidden md:block rounded-md border border-border overflow-hidden bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left p-3 text-xs text-muted-foreground font-medium">Type</th>
                  <th className="text-left p-3 text-xs text-muted-foreground font-medium">Pair</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">Quantity</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">Price</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">Total</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">Status</th>
                  <th className="text-right p-3 text-xs text-muted-foreground font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {tradeList.length > 0 ? (
                  tradeList.map((trade) => {
                    const isBuy = trade.type === "buy";
                    const coinName = trade.symbol.replace("USDT", "");
                    return (
                      <tr key={trade.id} className="border-b border-border/50" data-testid={`row-trade-${trade.id}`}>
                        <td className="p-3">
                          <div className={`flex items-center gap-1.5 font-medium ${isBuy ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>
                            {isBuy ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                            <span className="uppercase text-xs">{trade.type}</span>
                          </div>
                        </td>
                        <td className="p-3">
                          <span className="font-semibold text-foreground">{coinName}</span>
                          <span className="text-xs text-muted-foreground">/USDT</span>
                        </td>
                        <td className="p-3 text-right font-mono text-foreground">{trade.quantity.toFixed(6)}</td>
                        <td className="p-3 text-right font-mono text-muted-foreground">
                          ${trade.price.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                        </td>
                        <td className="p-3 text-right font-mono font-semibold text-foreground">
                          ${trade.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="p-3 text-right">
                          <Badge variant="outline" className="text-xs">
                            {trade.status}
                          </Badge>
                        </td>
                        <td className="p-3 text-right text-xs text-muted-foreground">
                          {trade.timestamp ? format(new Date(trade.timestamp), "MMM d, HH:mm:ss") : "-"}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      No trades yet. Place your first trade from the Market page.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="md:hidden space-y-2">
          {tradeList.length > 0 ? (
            tradeList.map((trade) => {
              const isBuy = trade.type === "buy";
              const coinName = trade.symbol.replace("USDT", "");
              return (
                <div
                  key={trade.id}
                  className="rounded-md border border-border bg-card p-3"
                  data-testid={`card-trade-${trade.id}`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <div className={`flex items-center gap-1 font-medium ${isBuy ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>
                        {isBuy ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                        <span className="uppercase text-xs font-semibold">{trade.type}</span>
                      </div>
                      <span className="font-semibold text-foreground text-sm">{coinName}/USDT</span>
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      {trade.status}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div className="flex justify-between gap-1">
                      <span className="text-muted-foreground">Qty</span>
                      <span className="font-mono text-foreground">{trade.quantity.toFixed(6)}</span>
                    </div>
                    <div className="flex justify-between gap-1">
                      <span className="text-muted-foreground">Price</span>
                      <span className="font-mono text-muted-foreground">${trade.price.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
                    </div>
                    <div className="flex justify-between gap-1">
                      <span className="text-muted-foreground">Total</span>
                      <span className="font-mono font-semibold text-foreground">${trade.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between gap-1">
                      <span className="text-muted-foreground">Date</span>
                      <span className="text-muted-foreground">{trade.timestamp ? format(new Date(trade.timestamp), "MMM d, HH:mm") : "-"}</span>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="p-8 text-center text-muted-foreground text-sm">
              No trades yet. Place your first trade from the Market page.
            </div>
          )}
        </div>
      </div>
    </LayoutShell>
  );
}
