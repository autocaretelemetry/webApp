import { Link } from "wouter";
import type { Part } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Package, Store } from "lucide-react";
import { formatCurrency, resolveImageUrl } from "@/lib/format";
import { cn } from "@/lib/utils";

export function PartCard({ part }: { part: Part }) {
  const lowStock = part.stock > 0 && part.stock <= 5;
  const outOfStock = part.stock === 0;
  return (
    <Link href={`/marketplace/${part.id}`}>
      <Card className="cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 overflow-hidden h-full flex flex-col">
        <div className="aspect-[4/3] bg-muted relative">
          {part.imageUrl ? (
            <img
              src={resolveImageUrl(part.imageUrl)}
              alt={part.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Package className="h-12 w-12 text-muted-foreground/40" />
            </div>
          )}
          <div className="absolute top-2 left-2 flex gap-1.5">
            <Badge variant="secondary" className="text-xs">{part.category}</Badge>
          </div>
          {(lowStock || outOfStock) && (
            <div className="absolute top-2 right-2">
              <Badge
                className={cn(
                  "text-xs",
                  outOfStock
                    ? "bg-gray-700 text-white"
                    : "bg-amber-500 text-white",
                )}
              >
                {outOfStock ? "Out of stock" : `${part.stock} left`}
              </Badge>
            </div>
          )}
        </div>
        <CardContent className="p-4 flex flex-col flex-1 gap-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold leading-tight line-clamp-2">{part.name}</h3>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2">{part.description}</p>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Store className="h-3 w-3" />
            <span className="truncate">{part.vendor?.name ?? "Vendor"}</span>
            <span>·</span>
            <span className="font-mono">{part.sku}</span>
          </div>
          <div className="mt-auto pt-2 flex items-end justify-between">
            <span className="text-lg font-bold text-primary">
              {formatCurrency(part.price)}
            </span>
            <span className="text-xs text-muted-foreground">{part.brand}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
