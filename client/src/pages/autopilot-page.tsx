import { useState } from "react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Bot, Plus, Trash2, Play, Pause, Settings2, TrendingUp, TrendingDown, Zap, Activity } from "lucide-react";
import type { AutopilotBot } from "@shared/schema";

const POPULAR_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "XRPUSDT", "SOLUSDT",
  "ADAUSDT", "DOGEUSDT", "LTCUSDT", "NEARUSDT", "POLUSDT",
  "FILUSDT", "ETCUSDT",
];

function CreateBotDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [side, setSide] = useState("buy");
  const [tradeAmount, setTradeAmount] = useState("10");
  const { toast } = useToast();

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; symbol: string; side: string; tradeAmount: number }) => {
      const res = await apiRequest("POST", "/api/autopilot/bots", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/autopilot/bots"] });
      toast({ title: "Bot Created", description: `${name} is ready. You can configure its strategy and start it when ready.` });
      setName("");
      setSymbol("BTCUSDT");
      setSide("buy");
      setTradeAmount("10");
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create bot", variant: "destructive" });
    },
  });

  const handleCreate = () => {
    if (!name.trim()) {
      toast({ title: "Error", description: "Please enter a bot name", variant: "destructive" });
      return;
    }
    createMutation.mutate({ name: name.trim(), symbol, side, tradeAmount: Number(tradeAmount) || 10 });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-[#0ecb81]" />
            Create New Bot
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Bot Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. BTC Scalper, ETH DCA Bot"
              data-testid="input-bot-name"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Trading Pair</Label>
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger data-testid="select-bot-symbol">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POPULAR_SYMBOLS.map((s) => (
                  <SelectItem key={s} value={s}>{s.replace("USDT", "/USDT")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Default Side</Label>
              <Select value={side} onValueChange={setSide}>
                <SelectTrigger data-testid="select-bot-side">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="buy">Buy</SelectItem>
                  <SelectItem value="sell">Sell</SelectItem>
                  <SelectItem value="both">Both (Buy & Sell)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Trade Amount (USDT)</Label>
              <Input
                type="number"
                value={tradeAmount}
                onChange={(e) => setTradeAmount(e.target.value)}
                min="5"
                step="1"
                data-testid="input-bot-amount"
              />
            </div>
          </div>
          <div className="rounded-md border border-border p-3 bg-muted/30">
            <p className="text-xs text-muted-foreground">
              Strategy rules will be configured after creation. You can set custom buy/sell conditions and the bot will execute trades automatically when conditions are met.
            </p>
          </div>
          <Button
            className="w-full bg-[#0ecb81] hover:bg-[#0ecb81]/90 text-black font-semibold"
            onClick={handleCreate}
            disabled={createMutation.isPending}
            data-testid="button-create-bot"
          >
            {createMutation.isPending ? "Creating..." : "Create Bot"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BotCard({ bot }: { bot: AutopilotBot }) {
  const { toast } = useToast();

  const toggleMutation = useMutation({
    mutationFn: async (isActive: boolean) => {
      await apiRequest("POST", `/api/autopilot/bots/${bot.id}/toggle`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/autopilot/bots"] });
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

  const pnlColor = bot.totalPnl >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]";
  const sideColor = bot.side === "buy" ? "text-[#0ecb81]" : bot.side === "sell" ? "text-[#f6465d]" : "text-[#f0b90b]";

  let strategyConfig: Record<string, unknown> = {};
  try { strategyConfig = JSON.parse(bot.strategyConfig || "{}"); } catch {}
  const hasStrategy = Object.keys(strategyConfig).length > 0;

  return (
    <Card className="p-4" data-testid={`card-bot-${bot.id}`}>
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
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-xs text-muted-foreground font-mono">{bot.symbol.replace("USDT", "/USDT")}</span>
              <span className={`text-xs font-medium uppercase ${sideColor}`}>{bot.side}</span>
              <span className="text-xs text-muted-foreground">${bot.tradeAmount} per trade</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
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
          <div className="text-sm font-mono font-semibold" data-testid={`text-bot-trades-${bot.id}`}>{bot.totalTrades}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Total PNL</div>
          <div className={`text-sm font-mono font-semibold ${pnlColor}`} data-testid={`text-bot-pnl-${bot.id}`}>
            {bot.totalPnl >= 0 ? "+" : ""}{bot.totalPnl.toFixed(2)} USDT
          </div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Strategy</div>
          <div className="text-sm">
            {hasStrategy ? (
              <Badge variant="secondary" className="text-[10px]">Configured</Badge>
            ) : (
              <span className="text-xs text-muted-foreground">Not set</span>
            )}
          </div>
        </div>
      </div>

      {bot.lastTradeAt && (
        <div className="text-[10px] text-muted-foreground mt-2">
          Last trade: {new Date(bot.lastTradeAt).toLocaleString()}
        </div>
      )}

      <div className="flex items-center justify-end gap-1 mt-3 pt-2 border-t border-border">
        <Button
          size="icon"
          variant="ghost"
          onClick={() => deleteMutation.mutate()}
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

  const { data: bots = [], isLoading } = useQuery<AutopilotBot[]>({
    queryKey: ["/api/autopilot/bots"],
  });

  const activeBots = bots.filter((b) => b.isActive);
  const totalPnl = bots.reduce((sum, b) => sum + b.totalPnl, 0);
  const totalTrades = bots.reduce((sum, b) => sum + b.totalTrades, 0);

  return (
    <LayoutShell>
      <div className="max-w-4xl mx-auto p-4 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2" data-testid="text-autopilot-title">
              <Zap className="w-5 h-5 text-[#f0b90b]" />
              Autopilot
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">Create and manage your trading bots</p>
          </div>
          <Button
            onClick={() => setCreateOpen(true)}
            className="bg-[#0ecb81] hover:bg-[#0ecb81]/90 text-black font-semibold gap-2"
            data-testid="button-new-bot"
          >
            <Plus className="w-4 h-4" />
            New Bot
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
              Create your first trading bot to automate your trades. Set up custom rules and let the bot execute trades based on your strategy.
            </p>
            <Button
              className="mt-4 bg-[#0ecb81] hover:bg-[#0ecb81]/90 text-black font-semibold gap-2"
              onClick={() => setCreateOpen(true)}
              data-testid="button-create-first-bot"
            >
              <Plus className="w-4 h-4" />
              Create Your First Bot
            </Button>
          </Card>
        ) : (
          <div className="space-y-3">
            {bots.map((bot) => (
              <BotCard key={bot.id} bot={bot} />
            ))}
          </div>
        )}

        <CreateBotDialog open={createOpen} onOpenChange={setCreateOpen} />
      </div>
    </LayoutShell>
  );
}