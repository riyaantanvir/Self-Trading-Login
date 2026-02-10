import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Bell, ArrowUpRight, ArrowDownLeft, TrendingUp, TrendingDown, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Notification } from "@shared/schema";

function getNotifIcon(type: string) {
  switch (type) {
    case "trade_buy":
      return <TrendingUp className="w-4 h-4 text-[#0ecb81] flex-shrink-0" />;
    case "trade_sell":
      return <TrendingDown className="w-4 h-4 text-[#f6465d] flex-shrink-0" />;
    case "transfer_sent":
      return <ArrowUpRight className="w-4 h-4 text-[#f6465d] flex-shrink-0" />;
    case "transfer_received":
      return <ArrowDownLeft className="w-4 h-4 text-[#0ecb81] flex-shrink-0" />;
    case "futures_open":
      return <TrendingUp className="w-4 h-4 text-[#f0b90b] flex-shrink-0" />;
    case "futures_profit":
      return <TrendingUp className="w-4 h-4 text-[#0ecb81] flex-shrink-0" />;
    case "futures_loss":
      return <TrendingDown className="w-4 h-4 text-[#f6465d] flex-shrink-0" />;
    default:
      return <Bell className="w-4 h-4 text-muted-foreground flex-shrink-0" />;
  }
}

function timeAgo(date: Date | string) {
  const now = new Date();
  const d = new Date(date);
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d`;
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
        <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 max-h-[70vh] bg-card border border-border rounded-md shadow-lg z-[10000] flex flex-col overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
            <span className="text-sm font-semibold text-foreground">Notifications</span>
            {unreadCount > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => markAllRead.mutate()}
                className="gap-1 text-xs text-muted-foreground"
                data-testid="button-mark-all-read"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Mark all read
              </Button>
            )}
          </div>

          <div className="overflow-y-auto flex-1">
            {sorted.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Bell className="w-8 h-8 mb-2 opacity-50" />
                <span className="text-sm">No notifications yet</span>
              </div>
            ) : (
              sorted.map((n) => (
                <div
                  key={n.id}
                  className={`flex items-start gap-3 px-4 py-3 border-b border-border/50 cursor-pointer transition-colors ${
                    !n.isRead ? "bg-muted/30" : ""
                  } hover-elevate`}
                  onClick={() => {
                    if (!n.isRead) markRead.mutate(n.id);
                  }}
                  data-testid={`notification-item-${n.id}`}
                >
                  <div className="mt-0.5">{getNotifIcon(n.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-foreground">{n.title}</span>
                      {!n.isRead && (
                        <span className="w-2 h-2 rounded-full bg-[#0ecb81] flex-shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{n.message}</p>
                    <span className="text-[10px] text-muted-foreground/60 mt-1 block">
                      {n.createdAt ? timeAgo(n.createdAt) : ""}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
