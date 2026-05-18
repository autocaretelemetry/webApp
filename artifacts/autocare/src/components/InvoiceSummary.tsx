import { Invoice } from "@workspace/api-client-react";
import { formatCurrency } from "@/lib/format";
import { StatusBadge } from "./StatusBadge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

interface InvoiceSummaryProps {
  invoice: Invoice;
  className?: string;
}

export function InvoiceSummary({ invoice, className }: InvoiceSummaryProps) {
  return (
    <Card className={className}>
      <CardHeader className="pb-4">
        <div className="flex justify-between items-center">
          <CardTitle>Invoice</CardTitle>
          <StatusBadge status={invoice.status} type="invoice" />
        </div>
        <p className="text-sm text-muted-foreground">ID: {invoice.id.split('-')[0].toUpperCase()}</p>
      </CardHeader>
      
      <CardContent className="space-y-4">
        <div className="rounded-md border overflow-hidden">
          <div className="bg-muted px-3 py-2 text-xs font-medium grid grid-cols-12 gap-2">
            <div className="col-span-6">Item</div>
            <div className="col-span-2 text-right">Qty</div>
            <div className="col-span-2 text-right">Price</div>
            <div className="col-span-2 text-right">Total</div>
          </div>
          <div className="divide-y text-sm">
            {invoice.items.map((item, i) => (
              <div key={i} className="px-3 py-2 grid grid-cols-12 gap-2 items-center">
                <div className="col-span-6 flex flex-col">
                  <span className="font-medium">{item.description}</span>
                  <span className="text-xs text-muted-foreground capitalize">{item.kind}</span>
                </div>
                <div className="col-span-2 text-right text-muted-foreground">{item.quantity}</div>
                <div className="col-span-2 text-right text-muted-foreground">{formatCurrency(item.unitPrice)}</div>
                <div className="col-span-2 text-right font-medium">{formatCurrency(item.quantity * item.unitPrice)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-1.5 text-sm pt-2">
          <div className="flex justify-between text-muted-foreground">
            <span>Parts</span>
            <span>{formatCurrency(invoice.partsTotal)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Labor</span>
            <span>{formatCurrency(invoice.laborTotal)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Tax</span>
            <span>{formatCurrency(invoice.tax)}</span>
          </div>
          <Separator className="my-2" />
          <div className="flex justify-between font-bold text-lg">
            <span>Total</span>
            <span className="text-primary">{formatCurrency(invoice.total)}</span>
          </div>
        </div>

        {invoice.notes && (
          <div className="mt-4 bg-muted/50 p-3 rounded-md text-sm">
            <span className="font-medium mb-1 block">Notes:</span>
            <span className="text-muted-foreground">{invoice.notes}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
