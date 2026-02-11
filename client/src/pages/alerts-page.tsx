import { useState } from "react";
import { LayoutShell } from "@/components/layout-shell";
import { useAlerts, useCreateAlert, useDeleteAlert, useTickers, useSaveTelegramSettings, useTestTelegram, useNewsAlerts, useToggleNewsAlerts, useSignalAlerts, useToggleSignalAlerts } from "@/hooks/use-trades";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Bell, BellOff, Trash2, ArrowUp, ArrowDown, Plus, X, Check, Send, Settings, Activity, Newspaper } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SiTelegram } from "react-icons/si";

export default function AlertsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: alerts, isLoading } = useAlerts();
  const { data: tickers } = useTickers();
  const createAlert = useCreateAlert();
  const deleteAlert = useDeleteAlert();
  const saveTelegram = useSaveTelegramSettings();
  const testTelegram = useTestTelegram();
  const { data: newsAlertData } = useNewsAlerts();
  const toggleNewsAlerts = useToggleNewsAlerts();
  const { data: signalAlertData } = useSignalAlerts();
  const toggleSignalAlerts = useToggleSignalAlerts();

  const [showCreate, setShowCreate] = useState(false);
  const [showTgSettings, setShowTgSettings] = useState(false);
  const [symbol, setSymbol] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [notifyTelegram, setNotifyTelegram] = useState(true);
  const [search, setSearch] = useState("");

  const [tgBotToken, setTgBotToken] = useState((user as any)?.telegramBotToken || "");
  const [tgChatId, setTgChatId] = useState((user as any)?.telegramChatId || "");

  const hasTelegramSetup = !!(user as any)?.telegramBotToken && !!(user as any)?.telegramChatId;

  const tickerList = (tickers as any[] | undefined) || [];
  const filteredTickers = tickerList
    .filter((t: any) => t.symbol.endsWith("USDT"))
    .filter((t: any) => t.symbol.toLowerCase().includes(search.toLowerCase()))
    .sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, 20);

  const activeAlerts = ((alerts as any[]) || []).filter((a: any) => a.isActive && !a.triggered);
  const triggeredAlerts = ((alerts as any[]) || []).filter((a: any) => a.triggered);

  const handleCreate = () => {
    if (!symbol || !targetPrice) return;
    createAlert.mutate(
      { symbol, targetPrice: parseFloat(targetPrice), direction, notifyTelegram: notifyTelegram && hasTelegramSetup },
      {
        onSuccess: () => {
          setShowCreate(false);
          setSymbol("");
          setTargetPrice("");
          setDirection("above");
          setNotifyTelegram(true);
          setSearch("");
        },
      }
    );
  };

  const handleSaveTelegram = () => {
    saveTelegram.mutate({ telegramBotToken: tgBotToken, telegramChatId: tgChatId });
  };

  const getCurrentPrice = (sym: string) => {
    const t = tickerList.find((t: any) => t.symbol === sym);
    return t ? parseFloat(t.lastPrice) : null;
  };

  return (
    <LayoutShell>
      <div className="px-3 py-3 md:p-4 max-w-2xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-[#f0b90b]" />
            <h1 className="text-xl font-bold" data-testid="text-alerts-title">Alerts</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={showTgSettings ? "secondary" : "outline"}
              size="sm"
              className="gap-2"
              onClick={() => setShowTgSettings(!showTgSettings)}
              data-testid="button-telegram-settings"
            >
              <SiTelegram className="w-4 h-4" />
              Telegram
            </Button>
            <Button
              size="sm"
              className="gap-2"
              onClick={() => setShowCreate(!showCreate)}
              data-testid="button-create-alert"
            >
              {showCreate ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {showCreate ? "Cancel" : "New Alert"}
            </Button>
          </div>
        </div>

        {showTgSettings && (
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <SiTelegram className="w-5 h-5 text-[#26A5E4]" />
              <div className="text-sm font-medium">Telegram Settings</div>
            </div>
            <p className="text-xs text-muted-foreground">
              Connect your Telegram bot to receive price alert notifications. Create a bot via @BotFather on Telegram, then enter your bot token and chat ID below.
            </p>
            <div className="space-y-2">
              <div>
                <Input
                  placeholder="e.g. 1234567890:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"
                  value={tgBotToken}
                  onChange={(e) => setTgBotToken(e.target.value)}
                  data-testid="input-telegram-bot-token"
                />
                <p className="text-xs text-muted-foreground mt-1">Bot Token from @BotFather (format: number:letters)</p>
              </div>
              <div>
                <Input
                  placeholder="e.g. 6788205627"
                  value={tgChatId}
                  onChange={(e) => setTgChatId(e.target.value)}
                  data-testid="input-telegram-chat-id"
                />
                <p className="text-xs text-muted-foreground mt-1">Your Chat ID (send /start to @userinfobot to get it)</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="gap-2"
                onClick={handleSaveTelegram}
                disabled={saveTelegram.isPending || !tgBotToken || !tgChatId}
                data-testid="button-save-telegram"
              >
                <Check className="w-4 h-4" />
                {saveTelegram.isPending ? "Saving..." : "Save"}
              </Button>
              {hasTelegramSetup && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => testTelegram.mutate()}
                  disabled={testTelegram.isPending}
                  data-testid="button-test-telegram"
                >
                  <Send className="w-4 h-4" />
                  {testTelegram.isPending ? "Sending..." : "Send Test"}
                </Button>
              )}
            </div>
            {hasTelegramSetup && (
              <div className="flex items-center gap-2 text-xs text-[#0ecb81]">
                <Check className="w-3 h-3" />
                Telegram connected
              </div>
            )}
            {hasTelegramSetup && (
              <div className="border-t border-border pt-3 mt-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Newspaper className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <div className="text-sm font-medium" data-testid="text-news-alerts-label">News Headline Alerts</div>
                      <p className="text-[10px] text-muted-foreground">
                        Receive new crypto news headlines via Telegram (checked every 2 min)
                      </p>
                    </div>
                  </div>
                  <Button
                    variant={newsAlertData?.enabled ? "default" : "outline"}
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      const newState = !newsAlertData?.enabled;
                      toggleNewsAlerts.mutate(newState, {
                        onSuccess: () => {
                          toast({
                            title: newState ? "News alerts enabled" : "News alerts disabled",
                            description: newState
                              ? "You'll receive crypto news headlines on Telegram"
                              : "News headline alerts have been turned off",
                          });
                        },
                        onError: (err: any) => {
                          toast({
                            title: "Error",
                            description: err.message || "Failed to update news alert settings",
                            variant: "destructive",
                          });
                        },
                      });
                    }}
                    disabled={toggleNewsAlerts.isPending}
                    data-testid="button-toggle-news-alerts"
                  >
                    {newsAlertData?.enabled ? (
                      <>
                        <Bell className="w-3.5 h-3.5" />
                        On
                      </>
                    ) : (
                      <>
                        <BellOff className="w-3.5 h-3.5" />
                        Off
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
            {hasTelegramSetup && (
              <div className="border-t border-border pt-3 mt-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <div className="text-sm font-medium" data-testid="text-signal-alerts-label">Smart Signal Alerts</div>
                      <p className="text-[10px] text-muted-foreground">
                        Get notified when buy signals appear near support or strong sell signals near resistance (checked every 60s, 30min cooldown per coin)
                      </p>
                    </div>
                  </div>
                  <Button
                    variant={signalAlertData?.enabled ? "default" : "outline"}
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      const newState = !signalAlertData?.enabled;
                      toggleSignalAlerts.mutate(newState, {
                        onSuccess: () => {
                          toast({
                            title: newState ? "Smart signal alerts enabled" : "Smart signal alerts disabled",
                            description: newState
                              ? "You'll receive buy/sell signals near key S/R zones on Telegram"
                              : "Smart signal alerts have been turned off",
                          });
                        },
                        onError: (err: any) => {
                          toast({
                            title: "Error",
                            description: err.message || "Failed to update signal alert settings",
                            variant: "destructive",
                          });
                        },
                      });
                    }}
                    disabled={toggleSignalAlerts.isPending}
                    data-testid="button-toggle-signal-alerts"
                  >
                    {signalAlertData?.enabled ? (
                      <>
                        <Bell className="w-3.5 h-3.5" />
                        On
                      </>
                    ) : (
                      <>
                        <BellOff className="w-3.5 h-3.5" />
                        Off
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </Card>
        )}

        {showCreate && (
          <Card className="p-4 space-y-3">
            <div className="text-sm font-medium text-muted-foreground">Create Price Alert</div>

            {!symbol ? (
              <div className="space-y-2">
                <Input
                  placeholder="Search coin..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  data-testid="input-alert-search"
                />
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {filteredTickers.map((t: any) => {
                    const coin = t.symbol.replace("USDT", "");
                    const price = parseFloat(t.lastPrice);
                    return (
                      <button
                        key={t.symbol}
                        className="w-full flex items-center justify-between p-2 rounded-md hover-elevate text-left"
                        onClick={() => {
                          setSymbol(t.symbol);
                          setTargetPrice(price.toString());
                        }}
                        data-testid={`button-select-coin-${t.symbol}`}
                      >
                        <span className="font-medium text-sm">{coin}/USDT</span>
                        <span className="text-xs text-muted-foreground font-mono">${price.toLocaleString()}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{symbol.replace("USDT", "")}/USDT</span>
                  <Button variant="ghost" size="icon" onClick={() => setSymbol("")} data-testid="button-change-coin">
                    <X className="w-3 h-3" />
                  </Button>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant={direction === "above" ? "default" : "outline"}
                    size="sm"
                    className="flex-1 gap-1"
                    onClick={() => setDirection("above")}
                    data-testid="button-direction-above"
                  >
                    <ArrowUp className="w-3 h-3" />
                    Above
                  </Button>
                  <Button
                    variant={direction === "below" ? "default" : "outline"}
                    size="sm"
                    className="flex-1 gap-1"
                    onClick={() => setDirection("below")}
                    data-testid="button-direction-below"
                  >
                    <ArrowDown className="w-3 h-3" />
                    Below
                  </Button>
                </div>

                <Input
                  type="number"
                  placeholder="Target price (USDT)"
                  value={targetPrice}
                  onChange={(e) => setTargetPrice(e.target.value)}
                  data-testid="input-target-price"
                />

                {hasTelegramSetup && (
                  <button
                    className={`w-full flex items-center gap-3 p-3 rounded-md border transition-colors ${
                      notifyTelegram
                        ? "border-[#26A5E4] bg-[#26A5E4]/10"
                        : "border-border"
                    }`}
                    onClick={() => setNotifyTelegram(!notifyTelegram)}
                    data-testid="button-toggle-telegram"
                  >
                    <SiTelegram className={`w-5 h-5 ${notifyTelegram ? "text-[#26A5E4]" : "text-muted-foreground"}`} />
                    <div className="text-left flex-1">
                      <div className="text-sm font-medium">Notify on Telegram</div>
                      <div className="text-xs text-muted-foreground">Send alert to your Telegram when triggered</div>
                    </div>
                    <div className={`w-10 h-6 rounded-full transition-colors flex items-center ${
                      notifyTelegram ? "bg-[#26A5E4] justify-end" : "bg-muted justify-start"
                    }`}>
                      <div className="w-5 h-5 rounded-full bg-white mx-0.5 shadow-sm" />
                    </div>
                  </button>
                )}

                {!hasTelegramSetup && (
                  <div className="flex items-center gap-2 p-3 rounded-md border border-border text-xs text-muted-foreground">
                    <SiTelegram className="w-4 h-4" />
                    <span>Set up Telegram above to enable notifications</span>
                  </div>
                )}

                <Button
                  className="w-full gap-2"
                  onClick={handleCreate}
                  disabled={createAlert.isPending || !targetPrice}
                  data-testid="button-confirm-alert"
                >
                  <Check className="w-4 h-4" />
                  {createAlert.isPending ? "Creating..." : "Create Alert"}
                </Button>
              </div>
            )}
          </Card>
        )}

        <div className="space-y-2">
          <div className="text-sm font-medium text-muted-foreground">Active Alerts ({activeAlerts.length})</div>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Loading...</div>
          ) : activeAlerts.length === 0 ? (
            <Card className="p-6 text-center">
              <Bell className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No active alerts</p>
              <p className="text-xs text-muted-foreground mt-1">Create an alert to get notified when a coin reaches your target price</p>
            </Card>
          ) : (
            activeAlerts.map((alert: any) => {
              const coin = alert.symbol.replace("USDT", "");
              const currentPrice = getCurrentPrice(alert.symbol);
              const isIndicator = alert.alertType === "indicator";
              const progress = !isIndicator && currentPrice
                ? alert.direction === "above"
                  ? Math.min(100, (currentPrice / alert.targetPrice) * 100)
                  : Math.min(100, (alert.targetPrice / currentPrice) * 100)
                : 0;

              return (
                <Card key={alert.id} className="p-3" data-testid={`card-alert-${alert.id}`}>
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                      <div className={`p-1.5 rounded-md ${isIndicator ? "bg-[#f0b90b]/10" : alert.direction === "above" ? "bg-[#0ecb81]/10" : "bg-[#f6465d]/10"}`}>
                        {isIndicator ? (
                          <Activity className="w-4 h-4 text-[#f0b90b]" />
                        ) : alert.direction === "above" ? (
                          <ArrowUp className="w-4 h-4 text-[#0ecb81]" />
                        ) : (
                          <ArrowDown className="w-4 h-4 text-[#f6465d]" />
                        )}
                      </div>
                      <div>
                        <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                          {coin}/USDT
                          {isIndicator && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#f0b90b]/10 text-[#f0b90b] font-mono">
                              BB {alert.indicatorCondition === "bb_upper" ? "Upper" : "Lower"} | {alert.chartInterval}
                            </span>
                          )}
                          {alert.notifyTelegram && (
                            <SiTelegram className="w-3 h-3 text-[#26A5E4]" />
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {isIndicator
                            ? `Alert when price hits ${alert.indicatorCondition === "bb_upper" ? "upper" : "lower"} Bollinger Band on ${alert.chartInterval} chart`
                            : `${alert.direction === "above" ? "Above" : "Below"} $${Number(alert.targetPrice).toLocaleString()}`
                          }
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {currentPrice !== null && (
                        <div className="text-right">
                          <div className="text-xs text-muted-foreground">Current</div>
                          <div className="text-sm font-mono">${currentPrice.toLocaleString()}</div>
                        </div>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteAlert.mutate(alert.id)}
                        data-testid={`button-delete-alert-${alert.id}`}
                      >
                        <Trash2 className="w-4 h-4 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>
                  {!isIndicator && (
                    <div className="mt-2 h-1 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${alert.direction === "above" ? "bg-[#0ecb81]" : "bg-[#f6465d]"}`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  )}
                </Card>
              );
            })
          )}
        </div>

        {triggeredAlerts.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium text-muted-foreground">Triggered ({triggeredAlerts.length})</div>
            {triggeredAlerts.map((alert: any) => {
              const coin = alert.symbol.replace("USDT", "");
              const isIndicator = alert.alertType === "indicator";
              return (
                <Card key={alert.id} className="p-3 opacity-60" data-testid={`card-triggered-${alert.id}`}>
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                      <div className="p-1.5 rounded-md bg-muted">
                        <BellOff className="w-4 h-4 text-muted-foreground" />
                      </div>
                      <div>
                        <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                          {coin}/USDT
                          {isIndicator && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                              BB {alert.indicatorCondition === "bb_upper" ? "Upper" : "Lower"} | {alert.chartInterval}
                            </span>
                          )}
                          {alert.notifyTelegram && (
                            <SiTelegram className="w-3 h-3 text-[#26A5E4]" />
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {isIndicator
                            ? `BB ${alert.indicatorCondition === "bb_upper" ? "Upper" : "Lower"} Band hit on ${alert.chartInterval}`
                            : `${alert.direction === "above" ? "Above" : "Below"} $${Number(alert.targetPrice).toLocaleString()}`
                          }
                          {alert.triggeredAt && (
                            <span className="ml-2">
                              {new Date(alert.triggeredAt).toLocaleString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteAlert.mutate(alert.id)}
                      data-testid={`button-delete-triggered-${alert.id}`}
                    >
                      <Trash2 className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </LayoutShell>
  );
}
