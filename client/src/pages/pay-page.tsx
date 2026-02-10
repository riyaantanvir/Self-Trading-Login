import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { LayoutShell } from "@/components/layout-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { ArrowLeft, Search, Send, CheckCircle2, ArrowUpRight, ArrowDownLeft, User } from "lucide-react";

type Step = "search" | "amount" | "confirm" | "success";

interface FoundUser {
  id: number;
  username: string;
}

interface TransferHistoryItem {
  id: number;
  senderId: number;
  receiverId: number;
  amount: number;
  note: string;
  status: string;
  timestamp: string;
  senderUsername: string;
  receiverUsername: string;
  direction: "sent" | "received";
}

export default function PayPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<FoundUser | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [lastTransfer, setLastTransfer] = useState<any>(null);

  const { data: searchResults = [], isFetching: isSearching } = useQuery<FoundUser[]>({
    queryKey: ["/api/pay/search-users", searchQuery],
    queryFn: async () => {
      if (!searchQuery.trim()) return [];
      const res = await fetch(`/api/pay/search-users?q=${encodeURIComponent(searchQuery)}`, { credentials: "include" });
      if (!res.ok) return [];
      return await res.json();
    },
    enabled: searchQuery.trim().length >= 1,
  });

  const { data: history = [], isLoading: historyLoading } = useQuery<TransferHistoryItem[]>({
    queryKey: ["/api/pay/history"],
    queryFn: async () => {
      const res = await fetch("/api/pay/history", { credentials: "include" });
      if (!res.ok) return [];
      return await res.json();
    },
  });

  const transferMutation = useMutation({
    mutationFn: async (data: { receiverId: number; amount: number; note: string }) => {
      const res = await apiRequest("POST", "/api/pay/transfer", data);
      return await res.json();
    },
    onSuccess: (data) => {
      setLastTransfer(data);
      setStep("success");
      queryClient.invalidateQueries({ queryKey: ["/api/pay/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
    },
    onError: (err: any) => {
      toast({ title: "Transfer Failed", description: err.message || "Something went wrong", variant: "destructive" });
    },
  });

  const handleSelectUser = useCallback((u: FoundUser) => {
    setSelectedUser(u);
    setStep("amount");
  }, []);

  const handleAmountNext = useCallback(() => {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt < 0.01) {
      toast({ title: "Invalid amount", description: "Minimum transfer is $0.01", variant: "destructive" });
      return;
    }
    if (user && amt > user.balance) {
      toast({ title: "Insufficient balance", description: "You don't have enough USDT", variant: "destructive" });
      return;
    }
    setStep("confirm");
  }, [amount, user, toast]);

  const handleConfirm = useCallback(() => {
    if (!selectedUser) return;
    transferMutation.mutate({
      receiverId: selectedUser.id,
      amount: parseFloat(amount),
      note,
    });
  }, [selectedUser, amount, note, transferMutation]);

  const handleReset = useCallback(() => {
    setStep("search");
    setSearchQuery("");
    setSelectedUser(null);
    setAmount("");
    setNote("");
    setLastTransfer(null);
  }, []);

  const handleBack = useCallback(() => {
    if (step === "amount") setStep("search");
    else if (step === "confirm") setStep("amount");
    else if (step === "success") handleReset();
  }, [step, handleReset]);

  if (!user) return <div />;

  return (
    <LayoutShell>
      <div className="max-w-lg mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-6">
          {step !== "search" && step !== "success" && (
            <Button variant="ghost" size="icon" onClick={handleBack} data-testid="button-pay-back">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          )}
          <h1 className="text-xl font-bold text-foreground" data-testid="text-pay-title">
            {step === "search" && "Pay"}
            {step === "amount" && "Enter Amount"}
            {step === "confirm" && "Confirm Transfer"}
            {step === "success" && "Transfer Complete"}
          </h1>
        </div>

        {step === "search" && (
          <div className="space-y-4">
            <Card>
              <CardContent className="pt-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by username..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                    data-testid="input-search-user"
                    autoFocus
                  />
                </div>
                {isSearching && (
                  <div className="text-sm text-muted-foreground text-center py-4">Searching...</div>
                )}
                {searchQuery.trim() && !isSearching && searchResults.length === 0 && (
                  <div className="text-sm text-muted-foreground text-center py-4">No users found</div>
                )}
                {searchResults.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {searchResults.map((u) => (
                      <button
                        key={u.id}
                        onClick={() => handleSelectUser(u)}
                        className="w-full flex items-center gap-3 p-3 rounded-md hover-elevate transition-colors"
                        data-testid={`button-user-${u.id}`}
                      >
                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                          <User className="w-5 h-5 text-muted-foreground" />
                        </div>
                        <div className="text-left">
                          <div className="font-medium text-foreground">{u.username}</div>
                          <div className="text-xs text-muted-foreground">ID: {u.id}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {history.length > 0 && !searchQuery.trim() && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Recent Transfers</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  {history.slice(0, 10).map((t) => (
                    <div key={t.id} className="flex items-center justify-between py-2.5 border-b border-border last:border-0" data-testid={`transfer-item-${t.id}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${t.direction === "sent" ? "bg-red-500/10" : "bg-green-500/10"}`}>
                          {t.direction === "sent"
                            ? <ArrowUpRight className="w-4 h-4 text-red-500" />
                            : <ArrowDownLeft className="w-4 h-4 text-green-500" />
                          }
                        </div>
                        <div>
                          <div className="text-sm font-medium text-foreground">
                            {t.direction === "sent" ? `To ${t.receiverUsername}` : `From ${t.senderUsername}`}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {t.timestamp ? new Date(t.timestamp).toLocaleString() : ""}
                          </div>
                        </div>
                      </div>
                      <div className={`text-sm font-mono font-semibold ${t.direction === "sent" ? "text-red-500" : "text-green-500"}`}>
                        {t.direction === "sent" ? "-" : "+"}${t.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {step === "amount" && selectedUser && (
          <Card>
            <CardContent className="pt-6 space-y-6">
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                  <User className="w-8 h-8 text-muted-foreground" />
                </div>
                <div className="font-semibold text-lg text-foreground" data-testid="text-recipient-name">{selectedUser.username}</div>
                <div className="text-xs text-muted-foreground">Recipient</div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-sm text-muted-foreground mb-1.5 block">Amount (USDT)</label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="text-center text-2xl font-mono h-14"
                    data-testid="input-amount"
                    autoFocus
                  />
                  <div className="text-xs text-muted-foreground text-right mt-1">
                    Available: ${user.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                  </div>
                </div>

                <div>
                  <label className="text-sm text-muted-foreground mb-1.5 block">Note (optional)</label>
                  <Input
                    placeholder="What's this for?"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={200}
                    data-testid="input-note"
                  />
                </div>
              </div>

              <Button
                className="w-full"
                onClick={handleAmountNext}
                disabled={!amount || parseFloat(amount) <= 0}
                data-testid="button-next"
              >
                Next
              </Button>
            </CardContent>
          </Card>
        )}

        {step === "confirm" && selectedUser && (
          <Card>
            <CardContent className="pt-6 space-y-6">
              <div className="text-center mb-2">
                <div className="text-3xl font-bold font-mono text-foreground" data-testid="text-confirm-amount">
                  ${parseFloat(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-sm text-muted-foreground mt-1">USDT</div>
              </div>

              <div className="bg-muted/50 rounded-md p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">To</span>
                  <span className="text-sm font-medium text-foreground" data-testid="text-confirm-recipient">{selectedUser.username}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">From</span>
                  <span className="text-sm font-medium text-foreground">{user.username}</span>
                </div>
                {note && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Note</span>
                    <span className="text-sm text-foreground max-w-[200px] truncate">{note}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Fee</span>
                  <span className="text-sm font-medium text-green-500">Free</span>
                </div>
              </div>

              <Button
                className="w-full bg-[#0ecb81] hover:bg-[#0ecb81]/90 text-white"
                onClick={handleConfirm}
                disabled={transferMutation.isPending}
                data-testid="button-confirm-transfer"
              >
                {transferMutation.isPending ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Processing...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Send className="w-4 h-4" />
                    Confirm & Send
                  </span>
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        {step === "success" && lastTransfer && (
          <Card>
            <CardContent className="pt-8 pb-8 text-center space-y-6">
              <div className="w-20 h-20 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-10 h-10 text-green-500" />
              </div>

              <div>
                <div className="text-2xl font-bold font-mono text-foreground mb-1" data-testid="text-success-amount">
                  ${parseFloat(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-sm text-muted-foreground">
                  Sent to <span className="font-medium text-foreground">{selectedUser?.username}</span>
                </div>
              </div>

              <div className="bg-muted/50 rounded-md p-4 space-y-2 text-left">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Transaction ID</span>
                  <span className="text-xs font-mono text-foreground">#{lastTransfer.id}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">New Balance</span>
                  <span className="text-xs font-mono text-foreground">${lastTransfer.newBalance?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </div>

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={handleReset} data-testid="button-send-another">
                  Send Another
                </Button>
                <Button className="flex-1" onClick={() => navigate("/assets")} data-testid="button-go-assets">
                  View Assets
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </LayoutShell>
  );
}
