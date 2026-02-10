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
  const [krakenApiKey, setKrakenApiKey] = useState("");
  const [krakenApiSecret, setKrakenApiSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);

  const { isRealMode, effectiveBalance, hasKrakenKeys, krakenBalance, krakenError } = useDemoRealMode();

  const { data: krakenKeysData } = useQuery<{ hasKeys: boolean; apiKey: string }>({
    queryKey: ["/api/user/kraken-keys"],
  });

  const toggleModeMutation = useMutation({
    mutationFn: async (tradingMode: string) => {
      await apiRequest("POST", "/api/user/trading-mode", { tradingMode });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/trading-mode"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/kraken/balance"] });
      toast({ title: "Trading mode updated" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const saveKeysMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/user/kraken-keys", {
        apiKey: krakenApiKey,
        apiSecret: krakenApiSecret,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/kraken-keys"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/trading-mode"] });
      setKrakenApiKey("");
      setKrakenApiSecret("");
      toast({ title: "Kraken API keys saved and verified" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteKeysMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/user/kraken-keys");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/kraken-keys"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/trading-mode"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      toast({ title: "Kraken API keys removed" });
    },
  });

  if (!user) return <></>;

  const hasKeys = krakenKeysData?.hasKeys || hasKrakenKeys;

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
                {isRealMode && krakenBalance !== undefined
                  ? `Kraken Balance: $${krakenBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
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
                  {isRealMode ? "Real Trading (Kraken)" : "Demo Trading (Simulated)"}
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
                Real trading mode is active. All trades will be executed on Kraken with real funds.
              </div>
            </div>
          )}
        </Card>

        <Card className="p-4 space-y-4">
          <div className="flex items-center gap-3">
            <Key className="w-5 h-5 text-muted-foreground" />
            <div>
              <div className="text-sm font-semibold text-foreground">Kraken API Keys</div>
              <div className="text-xs text-muted-foreground">
                {hasKeys ? "API keys configured" : "Required for real trading"}
              </div>
            </div>
          </div>

          {krakenError && hasKeys && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3" data-testid="text-kraken-error">
              <div className="text-xs text-destructive font-medium">{krakenError}</div>
            </div>
          )}

          {hasKeys && (
            <div className="rounded-md bg-muted p-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-green-500" />
                <span className="text-xs text-foreground">Connected: {krakenKeysData?.apiKey}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                data-testid="button-remove-kraken-keys"
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
                <Label htmlFor="kraken-api-key" className="text-xs">API Key</Label>
                <Input
                  id="kraken-api-key"
                  data-testid="input-kraken-api-key"
                  placeholder="Enter your Kraken API key"
                  value={krakenApiKey}
                  onChange={(e) => setKrakenApiKey(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="kraken-api-secret" className="text-xs">Private Key</Label>
                <div className="relative">
                  <Input
                    id="kraken-api-secret"
                    data-testid="input-kraken-api-secret"
                    type={showSecret ? "text" : "password"}
                    placeholder="Enter your Kraken private key"
                    value={krakenApiSecret}
                    onChange={(e) => setKrakenApiSecret(e.target.value)}
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
              <Button
                data-testid="button-save-kraken-keys"
                className="w-full"
                disabled={!krakenApiKey || !krakenApiSecret || saveKeysMutation.isPending}
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
                <p>1. Go to Kraken &gt; Settings &gt; API</p>
                <p>2. Click "Add Key" and select Query Funds + Create & Modify Orders</p>
                <p>3. Copy the API Key and Private Key</p>
              </div>
            </div>
          )}
        </Card>

        {isRealMode && krakenBalance !== undefined && (
          <Card className="p-4 space-y-2">
            <div className="text-sm font-semibold text-foreground">Kraken Account</div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">USD/USDT Available</span>
              <span className="text-sm font-semibold text-[#0ecb81]" data-testid="text-kraken-balance">
                ${krakenBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </Card>
        )}
      </div>
    </LayoutShell>
  );
}
