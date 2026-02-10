import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { LayoutShell } from "@/components/layout-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import { Shield, LogOut, ChevronRight, User, Key, AlertTriangle, Check, Loader2, Eye, EyeOff } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useDemoRealMode } from "@/hooks/use-trading-mode";

export default function SettingsPage() {
  const { user, logoutMutation } = useAuth();
  const { toast } = useToast();
  const [kucoinApiKey, setKucoinApiKey] = useState("");
  const [kucoinApiSecret, setKucoinApiSecret] = useState("");
  const [kucoinPassphrase, setKucoinPassphrase] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);

  const { isRealMode, effectiveBalance, hasKucoinKeys, kucoinBalance } = useDemoRealMode();

  const { data: kucoinKeysData } = useQuery<{ hasKeys: boolean; apiKey: string }>({
    queryKey: ["/api/user/kucoin-keys"],
  });

  const toggleModeMutation = useMutation({
    mutationFn: async (tradingMode: string) => {
      await apiRequest("POST", "/api/user/trading-mode", { tradingMode });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/trading-mode"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/kucoin/balance"] });
      toast({ title: "Trading mode updated" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const saveKeysMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/user/kucoin-keys", {
        apiKey: kucoinApiKey,
        apiSecret: kucoinApiSecret,
        passphrase: kucoinPassphrase,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/kucoin-keys"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/trading-mode"] });
      setKucoinApiKey("");
      setKucoinApiSecret("");
      setKucoinPassphrase("");
      toast({ title: "KuCoin API keys saved and verified" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteKeysMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/user/kucoin-keys");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/kucoin-keys"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/trading-mode"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      toast({ title: "KuCoin API keys removed" });
    },
  });

  if (!user) return <></>;

  const hasKeys = kucoinKeysData?.hasKeys || hasKucoinKeys;

  return (
    <LayoutShell>
      <div className="max-w-lg mx-auto p-4 space-y-4">
        <h1 className="text-lg font-bold text-foreground" data-testid="text-settings-title">Settings</h1>

        <Card className="divide-y divide-border">
          <div className="flex items-center gap-3 p-4">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
              <User className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground" data-testid="text-settings-username">{user.username}</div>
              <div className="text-xs text-muted-foreground">
                {isRealMode && kucoinBalance !== undefined
                  ? `KuCoin Balance: $${kucoinBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : `Demo Balance: $${Number(effectiveBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                }
              </div>
            </div>
          </div>

          {user.isAdmin && (
            <Link href="/admin">
              <div className="flex items-center justify-between gap-2 p-4 hover-elevate cursor-pointer" data-testid="link-admin-panel">
                <div className="flex items-center gap-3">
                  <Shield className="w-5 h-5 text-[#f0b90b]" />
                  <div>
                    <div className="text-sm font-medium text-foreground">Admin Panel</div>
                    <div className="text-xs text-muted-foreground">Manage users and settings</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </div>
            </Link>
          )}

          <div
            className="flex items-center justify-between gap-2 p-4 hover-elevate cursor-pointer"
            onClick={() => logoutMutation.mutate()}
            data-testid="button-logout"
          >
            <div className="flex items-center gap-3">
              <LogOut className="w-5 h-5 text-[#f6465d]" />
              <div>
                <div className="text-sm font-medium text-[#f6465d]">Log Out</div>
                <div className="text-xs text-muted-foreground">Sign out of your account</div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </div>
        </Card>

        <Card className="p-4 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <Key className="w-5 h-5 text-[#f0b90b]" />
              <div>
                <div className="text-sm font-semibold text-foreground">Trading Mode</div>
                <div className="text-xs text-muted-foreground">
                  {isRealMode ? "Real Trading (KuCoin)" : "Demo Trading (Simulated)"}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{isRealMode ? "Real" : "Demo"}</span>
              <Switch
                data-testid="switch-trading-mode"
                checked={isRealMode}
                disabled={toggleModeMutation.isPending || (!hasKeys && !isRealMode)}
                onCheckedChange={(checked) => {
                  toggleModeMutation.mutate(checked ? "real" : "demo");
                }}
              />
            </div>
          </div>

          {isRealMode && (
            <div className="rounded-md bg-destructive/10 p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
              <div className="text-xs text-destructive">
                Real trading mode is active. All trades will be executed on KuCoin with real funds.
              </div>
            </div>
          )}
        </Card>

        <Card className="p-4 space-y-4">
          <div className="flex items-center gap-3">
            <Key className="w-5 h-5 text-muted-foreground" />
            <div>
              <div className="text-sm font-semibold text-foreground">KuCoin API Keys</div>
              <div className="text-xs text-muted-foreground">
                {hasKeys ? "API keys configured" : "Required for real trading"}
              </div>
            </div>
          </div>

          {hasKeys && (
            <div className="rounded-md bg-muted p-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-green-500" />
                <span className="text-xs text-foreground">Connected: {kucoinKeysData?.apiKey}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                data-testid="button-remove-kucoin-keys"
                onClick={() => deleteKeysMutation.mutate()}
                disabled={deleteKeysMutation.isPending}
                className="text-destructive"
              >
                Remove
              </Button>
            </div>
          )}

          {!hasKeys && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="kucoin-api-key" className="text-xs">API Key</Label>
                <Input
                  id="kucoin-api-key"
                  data-testid="input-kucoin-api-key"
                  placeholder="Enter your KuCoin API key"
                  value={kucoinApiKey}
                  onChange={(e) => setKucoinApiKey(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="kucoin-api-secret" className="text-xs">API Secret</Label>
                <div className="relative">
                  <Input
                    id="kucoin-api-secret"
                    data-testid="input-kucoin-api-secret"
                    type={showSecret ? "text" : "password"}
                    placeholder="Enter your KuCoin API secret"
                    value={kucoinApiSecret}
                    onChange={(e) => setKucoinApiSecret(e.target.value)}
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                    onClick={() => setShowSecret(!showSecret)}
                  >
                    {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="kucoin-passphrase" className="text-xs">Passphrase</Label>
                <div className="relative">
                  <Input
                    id="kucoin-passphrase"
                    data-testid="input-kucoin-passphrase"
                    type={showPassphrase ? "text" : "password"}
                    placeholder="Enter your KuCoin trading passphrase"
                    value={kucoinPassphrase}
                    onChange={(e) => setKucoinPassphrase(e.target.value)}
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                    onClick={() => setShowPassphrase(!showPassphrase)}
                  >
                    {showPassphrase ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <Button
                data-testid="button-save-kucoin-keys"
                className="w-full"
                disabled={!kucoinApiKey || !kucoinApiSecret || !kucoinPassphrase || saveKeysMutation.isPending}
                onClick={() => saveKeysMutation.mutate()}
              >
                {saveKeysMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Save & Verify Keys"
                )}
              </Button>
              <div className="text-xs text-muted-foreground space-y-1">
                <p>1. Go to KuCoin &gt; API Management</p>
                <p>2. Create a new API key with Trade permissions</p>
                <p>3. Set a passphrase and IP restriction if needed</p>
              </div>
            </div>
          )}
        </Card>

        {isRealMode && kucoinBalance !== undefined && (
          <Card className="p-4 space-y-2">
            <div className="text-sm font-semibold text-foreground">KuCoin Account</div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">USDT Available</span>
              <span className="text-sm font-semibold text-[#0ecb81]" data-testid="text-kucoin-balance">
                ${kucoinBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </Card>
        )}
      </div>
    </LayoutShell>
  );
}
