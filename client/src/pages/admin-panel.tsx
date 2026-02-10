import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { LayoutShell } from "@/components/layout-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Redirect } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Users,
  Wallet,
  ArrowLeft,
  DollarSign,
  Plus,
  Loader2,
  Coins,
  Search,
  X,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type AdminView = "overview" | "users" | "coins";

interface AdminUser {
  id: number;
  username: string;
  email: string;
  isAdmin: boolean;
  balance: number;
}

export default function AdminPanel() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [view, setView] = useState<AdminView>("overview");
  const [topUpUserId, setTopUpUserId] = useState<number | null>(null);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [coinSearch, setCoinSearch] = useState("");
  const [addingCoin, setAddingCoin] = useState("");

  const usersQuery = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
    enabled: view === "users",
  });

  const trackedCoinsQuery = useQuery<string[]>({
    queryKey: ["/api/admin/tracked-coins"],
    enabled: view === "coins",
  });

  const topUpMutation = useMutation({
    mutationFn: async ({ userId, amount }: { userId: number; amount: number }) => {
      const res = await apiRequest("POST", "/api/admin/topup", { userId, amount });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Balance Updated",
        description: `Added $${Number(topUpAmount).toLocaleString()} USDT to ${data.username}'s account. New balance: $${Number(data.newBalance).toLocaleString()}`,
      });
      setTopUpUserId(null);
      setTopUpAmount("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
    onError: (error: any) => {
      toast({
        title: "Top-up Failed",
        description: error?.message || "Could not add funds",
        variant: "destructive",
      });
    },
  });

  const addCoinMutation = useMutation({
    mutationFn: async (symbol: string) => {
      const res = await apiRequest("POST", "/api/admin/tracked-coins", { symbol });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Coin Added", description: `${addingCoin.toUpperCase()} is now being tracked` });
      setAddingCoin("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tracked-coins"] });
    },
    onError: (error: any) => {
      toast({ title: "Failed", description: error?.message || "Could not add coin", variant: "destructive" });
    },
  });

  const removeCoinMutation = useMutation({
    mutationFn: async (symbol: string) => {
      const res = await apiRequest("DELETE", `/api/admin/tracked-coins/${symbol}`);
      return res.json();
    },
    onSuccess: (_data, symbol) => {
      toast({ title: "Coin Removed", description: `${symbol.toUpperCase()} removed from tracking` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tracked-coins"] });
    },
    onError: (error: any) => {
      toast({ title: "Failed", description: error?.message || "Could not remove coin", variant: "destructive" });
    },
  });

  if (!user?.isAdmin) {
    return <Redirect to="/" />;
  }

  const selectedUser = usersQuery.data?.find((u) => u.id === topUpUserId);

  const filteredCoins = trackedCoinsQuery.data?.filter(c =>
    c.toLowerCase().includes(coinSearch.toLowerCase())
  ) || [];

  if (view === "coins") {
    return (
      <LayoutShell>
        <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setView("overview")}
              data-testid="button-back-overview"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-xl font-bold text-foreground" data-testid="text-admin-coins-title">
                Manage Tracked Coins
              </h1>
              <p className="text-xs text-muted-foreground">
                Add or remove coins from your market list
              </p>
            </div>
          </div>

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="text-sm font-medium text-foreground">Add New Coin</div>
              <p className="text-xs text-muted-foreground">
                Enter the Binance trading pair symbol (e.g. SHIBUSDT, MATICUSDT, PEPEUSDT)
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. SHIBUSDT"
                  value={addingCoin}
                  onChange={(e) => setAddingCoin(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && addingCoin.trim()) {
                      addCoinMutation.mutate(addingCoin.trim());
                    }
                  }}
                  data-testid="input-add-coin"
                />
                <Button
                  disabled={!addingCoin.trim() || addCoinMutation.isPending}
                  onClick={() => addingCoin.trim() && addCoinMutation.mutate(addingCoin.trim())}
                  data-testid="button-add-coin"
                >
                  {addCoinMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4 mr-1" />
                  )}
                  Add
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search coins..."
              className="pl-9"
              value={coinSearch}
              onChange={(e) => setCoinSearch(e.target.value)}
              data-testid="input-search-coins"
            />
            {coinSearch && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2"
                onClick={() => setCoinSearch("")}
              >
                <X className="w-3 h-3" />
              </Button>
            )}
          </div>

          <div className="text-xs text-muted-foreground">
            {trackedCoinsQuery.data?.length || 0} coins tracked
          </div>

          {trackedCoinsQuery.isLoading && (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {filteredCoins.length > 0 && (
            <div className="space-y-1">
              {filteredCoins.map((coin) => (
                <div
                  key={coin}
                  className="flex items-center justify-between p-3 rounded-md bg-card border border-border"
                  data-testid={`row-coin-${coin}`}
                >
                  <div className="flex items-center gap-3">
                    <Coins className="w-4 h-4 text-[#f0b90b]" />
                    <span className="text-sm font-mono font-medium text-foreground">
                      {coin.toUpperCase().replace("USDT", "")}<span className="text-muted-foreground">/USDT</span>
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeCoinMutation.mutate(coin)}
                    disabled={removeCoinMutation.isPending}
                    data-testid={`button-remove-${coin}`}
                  >
                    <Trash2 className="w-4 h-4 text-[#f6465d]" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {!trackedCoinsQuery.isLoading && filteredCoins.length === 0 && coinSearch && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No coins matching "{coinSearch}"
            </div>
          )}
        </div>
      </LayoutShell>
    );
  }

  if (view === "users") {
    return (
      <LayoutShell>
        <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setView("overview")}
              data-testid="button-back-overview"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-xl font-bold text-foreground" data-testid="text-admin-users-title">
                User Management & Balance Top-up
              </h1>
              <p className="text-xs text-muted-foreground">
                View users and add demo USDT to their accounts
              </p>
            </div>
          </div>

          {usersQuery.isLoading && (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {usersQuery.data && (
            <div className="space-y-2">
              {usersQuery.data.map((u) => (
                <Card key={u.id} data-testid={`card-user-${u.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                          <Users className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm" data-testid={`text-username-${u.id}`}>
                              {u.username}
                            </span>
                            {u.isAdmin && (
                              <Badge variant="secondary" className="text-[10px]">
                                Admin
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <DollarSign className="w-3 h-3" />
                            <span data-testid={`text-balance-${u.id}`}>
                              {u.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                            </span>
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setTopUpUserId(u.id);
                          setTopUpAmount("");
                        }}
                        data-testid={`button-topup-${u.id}`}
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        Top Up
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {usersQuery.data?.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              No users found
            </div>
          )}

          <Dialog open={topUpUserId !== null} onOpenChange={(open) => !open && setTopUpUserId(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Top Up Balance</DialogTitle>
                <DialogDescription>
                  Add demo USDT to {selectedUser?.username}'s account
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  Current balance: <span className="text-foreground font-medium">${selectedUser?.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })} USDT</span>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Amount (USDT)</label>
                  <Input
                    type="number"
                    min="1"
                    step="any"
                    placeholder="Enter amount..."
                    value={topUpAmount}
                    onChange={(e) => setTopUpAmount(e.target.value)}
                    data-testid="input-topup-amount"
                  />
                </div>
                <div className="flex gap-2 flex-wrap">
                  {[1000, 5000, 10000, 50000, 100000].map((preset) => (
                    <Button
                      key={preset}
                      variant="outline"
                      size="sm"
                      onClick={() => setTopUpAmount(String(preset))}
                      data-testid={`button-preset-${preset}`}
                    >
                      ${preset.toLocaleString()}
                    </Button>
                  ))}
                </div>
                {topUpAmount && Number(topUpAmount) > 0 && (
                  <div className="text-xs text-muted-foreground">
                    New balance will be: <span className="text-foreground font-medium">
                      ${((selectedUser?.balance || 0) + Number(topUpAmount)).toLocaleString(undefined, { minimumFractionDigits: 2 })} USDT
                    </span>
                  </div>
                )}
                <Button
                  className="w-full"
                  disabled={!topUpAmount || Number(topUpAmount) <= 0 || topUpMutation.isPending}
                  onClick={() => {
                    if (topUpUserId && topUpAmount && Number(topUpAmount) > 0) {
                      topUpMutation.mutate({ userId: topUpUserId, amount: Number(topUpAmount) });
                    }
                  }}
                  data-testid="button-confirm-topup"
                >
                  {topUpMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-1" />
                  ) : (
                    <Wallet className="w-4 h-4 mr-1" />
                  )}
                  Add {topUpAmount ? `$${Number(topUpAmount).toLocaleString()}` : ""} USDT
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </LayoutShell>
    );
  }

  return (
    <LayoutShell>
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground" data-testid="text-page-title">
            Admin Panel
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your platform settings and users
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Card
            className="hover-elevate cursor-pointer"
            onClick={() => setView("users")}
            data-testid="card-admin-user-management"
          >
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-md bg-[#0ecb81]/10 flex items-center justify-center flex-shrink-0">
                  <Users className="w-5 h-5 text-[#0ecb81]" />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-foreground text-sm">User Management</div>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    View all registered users, edit profiles, and manage accounts
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card
            className="hover-elevate cursor-pointer"
            onClick={() => setView("users")}
            data-testid="card-admin-balance-top-up"
          >
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-md bg-[#0ecb81]/10 flex items-center justify-center flex-shrink-0">
                  <Wallet className="w-5 h-5 text-[#0ecb81]" />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-foreground text-sm">Balance Top-up</div>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Add funds to user accounts, manage deposits and withdrawals
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card
            className="hover-elevate cursor-pointer"
            onClick={() => setView("coins")}
            data-testid="card-admin-coin-management"
          >
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-md bg-[#f0b90b]/10 flex items-center justify-center flex-shrink-0">
                  <Coins className="w-5 h-5 text-[#f0b90b]" />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-foreground text-sm">Coin Management</div>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Add or remove coins from your tracked market list
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </LayoutShell>
  );
}
