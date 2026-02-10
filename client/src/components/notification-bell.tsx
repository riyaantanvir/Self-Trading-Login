import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Bell, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownLeft, CheckCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Notification } from "@shared/schema";

function getNotifIcon(type: string) {
  switch (type) {
    case "trade_buy":
      return <div className="w-8 h-8 rounded-full bg-[#0ecb81]/15 flex items-center justify-center flex-shrink-0"><TrendingUp className="w-4 h-4 text-[#0ecb81]" /></div>;
    case "trade_sell":
      return <div className="w-8 h-8 rounded-full bg-[#f6465d]/15 flex items-center justify-center flex-shrink-0"><TrendingDown className="w-4 h-4 text-[#f6465d]" /></div>;
    case "transfer_sent":
      return <div className="w-8 h-8 rounded-full bg-[#f6465d]/15 flex items-center justify-center flex-shrink-0"><ArrowUpRight className="w-4 h-4 text-[#f6465d]" /></div>;
    case "transfer_received":
      return <div className="w-8 h-8 rounded-full bg-[#0ecb81]/15 flex items-center justify-center flex-shrink-0"><ArrowDownLeft className="w-4 h-4 text-[#0ecb81]" /></div>;
    case "futures_open":
      return <div className="w-8 h-8 rounded-full bg-[#f0b90b]/15 flex items-center justify-center flex-shrink-0"><TrendingUp className="w-4 h-4 text-[#f0b90b]" /></div>;
    case "futures_profit":
      return <div className="w-8 h-8 rounded-full bg-[#0ecb81]/15 flex items-center justify-center flex-shrink-0"><TrendingUp className="w-4 h-4 text-[#0ecb81]" /></div>;
    case "futures_loss":
      return <div className="w-8 h-8 rounded-full bg-[#f6465d]/15 flex items-center justify-center flex-shrink-0"><TrendingDown className="w-4 h-4 text-[#f6465d]" /></div>;
    default:
      return <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0"><Bell className="w-4 h-4 text-muted-foreground" /></div>;
  }
}

function timeAgo(date: Date | string) {
  const now = new Date();
  const d = new Date(date);
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/unread-count"],
    refetchInterval: 10000,
  });

  const { data: notifications } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
    enabled: open,
  });

  const markAllRead = useMutation({
    mutationFn: () => apiRequest("POST", "/api/notifications/mark-all-read"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const markRead = useMutation({
    mutationFn: (notificationId: number) => apiRequest("POST", "/api/notifications/mark-read", { notificationId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClick);
    }
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const unreadCount = unreadData?.count || 0;
  const sorted = notifications ? [...notifications].sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()) : [];

  return (
    <div className="relative" ref={panelRef}>
      <Button
        size="icon"
        variant="ghost"
        onClick={() => {
          setOpen(!open);
          if (!open) {
            queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
          }
        }}
        data-testid="button-notifications"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-[#f6465d] text-white text-[10px] font-bold flex items-center justify-center px-1"
            data-testid="text-notification-count"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Button>

      {open && (
        <>
          <div className="hidden sm:block absolute right-0 top-full mt-2 w-80 max-h-[60vh] bg-popover border border-border rounded-md shadow-lg z-[10000] flex-col overflow-hidden" style={{ display: undefined }}>
            <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-border">
              <span className="text-sm font-semibold">Notifications</span>
              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => markAllRead.mutate()}
                    className="gap-1 text-xs text-muted-foreground"
                    data-testid="button-mark-all-read"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    Read all
                  </Button>
                )}
                <Button size="icon" variant="ghost" onClick={() => setOpen(false)} data-testid="button-close-notifications">
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1">
              {sorted.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                  <Bell className="w-7 h-7 mb-2 opacity-40" />
                  <span className="text-xs">No notifications</span>
                </div>
              ) : (
                sorted.map((n) => (
                  <div
                    key={n.id}
                    className={`flex items-start gap-3 px-3 py-2.5 border-b border-border/40 cursor-pointer transition-colors ${
                      !n.isRead ? "bg-muted/40" : ""
                    } hover-elevate`}
                    onClick={() => { if (!n.isRead) markRead.mutate(n.id); }}
                    data-testid={`notification-item-${n.id}`}
                  >
                    {getNotifIcon(n.type)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold truncate">{n.title}</span>
                        {!n.isRead && <span className="w-1.5 h-1.5 rounded-full bg-[#0ecb81] flex-shrink-0" />}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">{n.message}</p>
                      <span className="text-[10px] text-muted-foreground/50 mt-0.5 block">{n.createdAt ? timeAgo(n.createdAt) : ""}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="sm:hidden fixed inset-0 z-[10000] bg-background/80 backdrop-blur-sm" onClick={() => setOpen(false)}>
            <div
              className="absolute bottom-0 left-0 right-0 bg-card border-t border-border rounded-t-xl max-h-[70vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom-5 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
                <span className="text-sm font-semibold">Notifications</span>
                <div className="flex items-center gap-1">
                  {unreadCount > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => markAllRead.mutate()}
                      className="gap-1 text-xs text-muted-foreground"
                      data-testid="button-mark-all-read-mobile"
                    >
                      <CheckCheck className="w-3.5 h-3.5" />
                      Read all
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" onClick={() => setOpen(false)} data-testid="button-close-notifications-mobile">
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className="w-10 h-1 bg-muted-foreground/20 rounded-full mx-auto mt-1 mb-1" />
              <div className="overflow-y-auto flex-1 pb-safe">
                {sorted.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Bell className="w-8 h-8 mb-2 opacity-40" />
                    <span className="text-sm">No notifications</span>
                  </div>
                ) : (
                  sorted.map((n) => (
                    <div
                      key={n.id}
                      className={`flex items-start gap-3 px-4 py-3 border-b border-border/30 cursor-pointer transition-colors ${
                        !n.isRead ? "bg-muted/30" : ""
                      } hover-elevate`}
                      onClick={() => { if (!n.isRead) markRead.mutate(n.id); }}
                      data-testid={`notification-item-mobile-${n.id}`}
                    >
                      {getNotifIcon(n.type)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-semibold truncate">{n.title}</span>
                          {!n.isRead && <span className="w-2 h-2 rounded-full bg-[#0ecb81] flex-shrink-0" />}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{n.message}</p>
                        <span className="text-[10px] text-muted-foreground/50 mt-1 block">{n.createdAt ? timeAgo(n.createdAt) : ""}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
