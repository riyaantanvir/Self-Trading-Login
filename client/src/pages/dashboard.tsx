import { useAuth } from "@/hooks/use-auth";
import { useTrades } from "@/hooks/use-trades";
import { NewTradeDialog } from "@/components/new-trade-dialog";
import { LayoutShell } from "@/components/layout-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, TrendingDown, DollarSign, Activity } from "lucide-react";
import { format } from "date-fns";

export default function Dashboard() {
  const { user } = useAuth();
  const { data: trades, isLoading } = useTrades();

  if (isLoading) {
    return (
      <LayoutShell>
        <div className="flex items-center justify-center h-full min-h-[500px]">
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
        </div>
      </LayoutShell>
    );
  }

  // Simple stats calculation
  const totalTrades = trades?.length || 0;
  const activePositions = trades?.filter(t => t.status === 'open').length || 0;
  const totalVolume = trades?.reduce((acc, t) => acc + (t.price * t.quantity), 0) || 0;

  return (
    <LayoutShell>
      <div className="space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-white">Dashboard</h1>
            <p className="text-muted-foreground mt-1">
              Welcome back, {user?.username}. Here's your portfolio overview.
            </p>
          </div>
          <NewTradeDialog />
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="glass-panel border-l-4 border-l-primary/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Volume
              </CardTitle>
              <DollarSign className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">
                ${totalVolume.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Lifetime transaction value
              </p>
            </CardContent>
          </Card>
          
          <Card className="glass-panel border-l-4 border-l-accent/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Active Positions
              </CardTitle>
              <Activity className="h-4 w-4 text-accent" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">{activePositions}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Open trades currently in market
              </p>
            </CardContent>
          </Card>

          <Card className="glass-panel border-l-4 border-l-indigo-500/50">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Trades
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-indigo-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">{totalTrades}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Executed orders all-time
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Recent Trades Table */}
        <div className="rounded-xl border border-white/5 bg-card/30 backdrop-blur-sm overflow-hidden">
          <div className="p-6 border-b border-white/5 flex items-center justify-between">
            <h3 className="font-semibold text-lg text-white">Recent Trades</h3>
            <Badge variant="outline" className="border-white/10 text-muted-foreground">
              Last {trades?.length} Orders
            </Badge>
          </div>
          
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-white/5 hover:bg-white/5">
                <TableRow className="border-white/5 hover:bg-transparent">
                  <TableHead className="w-[100px] text-muted-foreground">Type</TableHead>
                  <TableHead className="text-muted-foreground">Symbol</TableHead>
                  <TableHead className="text-muted-foreground">Status</TableHead>
                  <TableHead className="text-right text-muted-foreground">Quantity</TableHead>
                  <TableHead className="text-right text-muted-foreground">Price</TableHead>
                  <TableHead className="text-right text-muted-foreground">Total Value</TableHead>
                  <TableHead className="text-right text-muted-foreground">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trades && trades.length > 0 ? (
                  trades.map((trade) => (
                    <TableRow key={trade.id} className="border-white/5 hover:bg-white/5 transition-colors">
                      <TableCell>
                        <div className={`flex items-center gap-2 font-medium ${
                          trade.type === 'buy' ? 'text-primary' : 'text-destructive'
                        }`}>
                          {trade.type === 'buy' ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                          <span className="uppercase">{trade.type}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-semibold text-white">{trade.symbol}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`
                          ${trade.status === 'open' 
                            ? 'bg-primary/10 text-primary border-primary/20' 
                            : 'bg-muted text-muted-foreground border-white/10'
                          }
                        `}>
                          {trade.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {trade.quantity}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        ${trade.price.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium text-white">
                        ${(trade.quantity * trade.price).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {trade.timestamp && format(new Date(trade.timestamp), "MMM d, HH:mm")}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                      No trades found. Execute your first trade to see it here.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </LayoutShell>
  );
}
