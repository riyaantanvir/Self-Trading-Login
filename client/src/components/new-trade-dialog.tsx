import { useState, useEffect } from "react";
import { useCreateTrade } from "@/hooks/use-trades";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

const tradeFormSchema = z.object({
  quantity: z.coerce.number().positive("Quantity must be greater than 0"),
});

type TradeFormValues = z.infer<typeof tradeFormSchema>;

interface TradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  symbol: string;
  currentPrice: number;
}

export function TradeDialog({ open, onOpenChange, symbol, currentPrice }: TradeDialogProps) {
  const [type, setType] = useState<"buy" | "sell">("buy");
  const createTrade = useCreateTrade();

  const form = useForm<TradeFormValues>({
    resolver: zodResolver(tradeFormSchema),
    defaultValues: { quantity: 0 },
  });

  const watchedQuantity = form.watch("quantity");
  const numQuantity = Number(watchedQuantity) || 0;
  const total = numQuantity * currentPrice;

  useEffect(() => {
    if (open) {
      form.reset({ quantity: 0 });
      setType("buy");
    }
  }, [open, form]);

  function onSubmit(data: TradeFormValues) {
    createTrade.mutate(
      { symbol, type, quantity: data.quantity, price: currentPrice },
      { onSuccess: () => onOpenChange(false) }
    );
  }

  const coinName = symbol.replace("USDT", "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px] border-border bg-card">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Trade {coinName}/USDT</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 mb-4">
          <Button
            variant={type === "buy" ? "default" : "ghost"}
            className={`flex-1 toggle-elevate ${type === "buy" ? "toggle-elevated bg-primary" : ""}`}
            onClick={() => setType("buy")}
            data-testid="button-buy-tab"
          >
            Buy
          </Button>
          <Button
            variant={type === "sell" ? "destructive" : "ghost"}
            className={`flex-1 toggle-elevate ${type === "sell" ? "toggle-elevated" : ""}`}
            onClick={() => setType("sell")}
            data-testid="button-sell-tab"
          >
            Sell
          </Button>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Price (USDT)</label>
              <Input
                value={`$${currentPrice.toLocaleString(undefined, { maximumFractionDigits: 8 })}`}
                disabled
                className="font-mono bg-background/50 border-border"
                data-testid="input-price"
              />
            </div>

            <FormField
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs text-muted-foreground">Amount ({coinName})</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="any"
                      min="0"
                      placeholder="0.00"
                      className="font-mono bg-background/50 border-border"
                      data-testid="input-quantity"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-between text-sm py-2 border-t border-border">
              <span className="text-muted-foreground">Total</span>
              <span className="font-mono font-semibold" data-testid="text-total">
                ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
              </span>
            </div>

            <Button
              type="submit"
              disabled={createTrade.isPending || numQuantity <= 0}
              variant={type === "buy" ? "default" : "destructive"}
              className="w-full font-bold"
              data-testid="button-submit-trade"
            >
              {createTrade.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                `${type === "buy" ? "Buy" : "Sell"} ${coinName}`
              )}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
