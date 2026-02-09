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

        <div className="rounded-md border border-border overflow-hidden bg-card">
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
      </div>
    </LayoutShell>
  );
}
