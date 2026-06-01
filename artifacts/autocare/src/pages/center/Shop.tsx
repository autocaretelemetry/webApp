import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useListPartCategories,
  useUpdatePart,
  type Part,
} from "@workspace/api-client-react";
import {
  getListPartsQueryKey,
  getGetPartQueryKey,
} from "@/lib/queryKeys";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ImageUploader } from "@/components/ImageUploader";
import { formatCurrency, resolveImageUrl } from "@/lib/format";
import { toast } from "sonner";
import { Building2, Loader2, Package, Plus, Save, X } from "lucide-react";
import { API_ROOT } from "../../lib/api-base";

// Center-shop endpoints live outside the OpenAPI surface (single client,
// plain Express + Zod on the server). We hit them with fetch + React Query
// the same way the fleet endpoints do.
const API = API_ROOT;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON */
    }
    const message =
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

const centerShopKey = (centerId: string) => ["center", centerId, "shop-parts"] as const;

function useCenterShopParts(centerId: string | undefined) {
  return useQuery<Part[]>({
    queryKey: centerShopKey(centerId ?? ""),
    queryFn: () => request<Part[]>(`/service-centers/${centerId}/parts`),
    enabled: !!centerId,
  });
}

function useCreateCenterShopPart(centerId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation<
    Part,
    Error,
    {
      name: string;
      description: string;
      category: string;
      brand: string;
      sku: string;
      price: number;
      stock: number;
      imageUrl: string | null;
      compatibleBrands: string[];
    }
  >({
    mutationFn: (data) =>
      request<Part>(`/service-centers/${centerId}/parts`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      if (centerId) {
        queryClient.invalidateQueries({ queryKey: centerShopKey(centerId) });
      }
      queryClient.invalidateQueries({ queryKey: getListPartsQueryKey() });
    },
  });
}

const CATEGORY_SUGGESTIONS = [
  "Brakes",
  "Engine",
  "Suspension",
  "Body",
  "Electrical",
  "Fluids",
  "Filters",
  "Tires",
];

/**
 * Category picker for the new-part form. Shows a dropdown of the seeded
 * suggestions + every category already in the public catalog, alongside
 * a separate "Add new" button that opens an inline text input. The new
 * value is selected immediately and joins the dropdown next time the
 * catalog query refreshes.
 */
function CategoryPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const { data: catalog } = useListPartCategories();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const knownCategories = useMemo(() => {
    const set = new Set<string>(CATEGORY_SUGGESTIONS);
    for (const c of catalog ?? []) if (c.category) set.add(c.category);
    if (value) set.add(value);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [catalog, value]);

  return (
    <div className="mt-1.5 space-y-2">
      <div className="flex gap-2">
        <select
          id="cat"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="" disabled>
            Select a category…
          </option>
          {knownCategories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => {
            setDraft("");
            setAdding((a) => !a);
          }}
        >
          <Plus className="h-4 w-4" />
          Add new
        </Button>
      </div>
      {adding && (
        <div className="flex gap-2">
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="New category name (e.g. Lubricants)"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const trimmed = draft.trim();
                if (trimmed) {
                  onChange(trimmed);
                  setAdding(false);
                }
              } else if (e.key === "Escape") {
                setAdding(false);
                setDraft("");
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            onClick={() => {
              const trimmed = draft.trim();
              if (!trimmed) {
                toast.error("Category name can't be empty.");
                return;
              }
              onChange(trimmed);
              setAdding(false);
            }}
          >
            Add
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setAdding(false);
              setDraft("");
            }}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

function NewPartForm({
  centerId,
  onClose,
}: {
  centerId: string;
  onClose: () => void;
}) {
  const create = useCreateCenterShopPart(centerId);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState(0);
  const [stock, setStock] = useState(1);
  const [imageUrl, setImageUrl] = useState("");

  const submit = async () => {
    if (!name.trim() || !description.trim() || !brand.trim() || !sku.trim()) {
      toast.error("Name, description, brand, and SKU are required.");
      return;
    }
    if (!category.trim()) {
      toast.error("Pick a category or type a new one.");
      return;
    }
    if (price <= 0) {
      toast.error("Price must be greater than zero.");
      return;
    }
    if (!imageUrl) {
      toast.error("Upload a photo of the part.");
      return;
    }
    try {
      await create.mutateAsync({
        name: name.trim(),
        description: description.trim(),
        category: category.trim(),
        brand: brand.trim(),
        sku: sku.trim(),
        price,
        stock,
        imageUrl,
        compatibleBrands: [],
      });
      toast.success("Part added to your shop.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add part.");
    }
  };

  return (
    <Card className="border-primary/40">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <p className="font-semibold">Add a new part to your shop</p>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div>
          <Label htmlFor="name">Part name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1.5"
            placeholder="e.g. Engine Oil Filter"
          />
        </div>
        <div>
          <Label htmlFor="desc">Description</Label>
          <Textarea
            id="desc"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1.5"
          />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="brand">Brand</Label>
            <Input
              id="brand"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="sku">SKU</Label>
            <Input
              id="sku"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              className="mt-1.5"
            />
          </div>
        </div>
        <div>
          <Label htmlFor="cat">Category</Label>
          <CategoryPicker value={category} onChange={setCategory} />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="price">Price</Label>
            <Input
              id="price"
              type="number"
              min={0}
              step="0.01"
              value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="stock">Stock on hand</Label>
            <Input
              id="stock"
              type="number"
              min={0}
              value={stock}
              onChange={(e) =>
                setStock(Math.max(0, Math.floor(Number(e.target.value))))
              }
              className="mt-1.5"
            />
          </div>
        </div>
        <div>
          <Label>
            Part photo <span className="text-destructive">*</span>
          </Label>
          <div className="mt-1.5">
            <ImageUploader
              value={imageUrl}
              onChange={setImageUrl}
              label="Upload a photo of the part"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={create.isPending}>
            {create.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Add to shop"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StockEditor({ part, centerId }: { part: Part; centerId: string }) {
  const [stock, setStock] = useState(part.stock);
  const [price, setPrice] = useState(part.price);
  const update = useUpdatePart();
  const queryClient = useQueryClient();
  const dirty = stock !== part.stock || price !== part.price;

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: centerShopKey(centerId) }),
      queryClient.invalidateQueries({ queryKey: getListPartsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetPartQueryKey(part.id) }),
    ]);

  const save = async () => {
    try {
      await update.mutateAsync({ partId: part.id, data: { stock, price } });
      await refresh();
      toast.success(`Updated ${part.name}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed.");
    }
  };

  const toggleActive = async () => {
    try {
      await update.mutateAsync({
        partId: part.id,
        data: { active: !part.active },
      });
      await refresh();
      toast.success(
        part.active ? "Part hidden from shop." : "Part listed in shop.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed.");
    }
  };

  return (
    <div className="flex items-end gap-2 flex-wrap">
      <div>
        <label className="text-xs text-muted-foreground">Price</label>
        <Input
          type="number"
          step="0.01"
          min={0}
          value={price}
          onChange={(e) => setPrice(Number(e.target.value))}
          className="w-24 h-9"
        />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Stock</label>
        <Input
          type="number"
          min={0}
          value={stock}
          onChange={(e) =>
            setStock(Math.max(0, Math.floor(Number(e.target.value))))
          }
          className="w-20 h-9"
        />
      </div>
      <Button
        size="sm"
        onClick={save}
        disabled={!dirty || update.isPending}
        className="gap-1"
      >
        <Save className="h-3.5 w-3.5" /> Save
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={toggleActive}
        disabled={update.isPending}
      >
        {part.active ? "Unlist" : "Relist"}
      </Button>
    </div>
  );
}

type SubscriberOption = {
  kind: "owner" | "center" | "vendor" | "organization";
  subscriberId: string;
  name: string;
};

function useMyCenter() {
  return useQuery<{ id: string; name: string } | null>({
    queryKey: ["me/subscriber-options", "center"],
    queryFn: async () => {
      const r = await fetch(`${API}/me/subscriber-options`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`Request failed (${r.status})`);
      const body = (await r.json()) as { options: SubscriberOption[] };
      const first = body.options.find((o) => o.kind === "center");
      return first ? { id: first.subscriberId, name: first.name } : null;
    },
  });
}

export default function CenterShop() {
  // Resolve the staffer's OWN service center via /me/subscriber-options,
  // which is membership-scoped (returns the centers this user is staff for).
  // The global directory hook would land on whatever rated highest and 403
  // every shop call.
  const { data: center, isLoading: centersLoading, error: centerError } =
    useMyCenter();
  const { data: parts, isLoading, error: partsError } = useCenterShopParts(
    center?.id,
  );
  const [adding, setAdding] = useState(false);

  if (centersLoading) {
    return <div className="p-8">Loading…</div>;
  }
  if (centerError) {
    return (
      <div className="p-8 text-sm text-destructive">
        Couldn't look up your service center: {centerError.message}
      </div>
    );
  }
  if (!center) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        You aren't associated with a service center yet. Ask your super admin
        to link your account to your center.
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <PageHeader
        title="My shop"
        description="Parts you keep on hand at the center. These are picked up at the workshop — no delivery."
        actions={
          !adding && (
            <Button className="gap-1.5" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> Add part
            </Button>
          )
        }
      />

      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4 text-sm flex items-start gap-3">
          <Building2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">{center.name}</p>
            <p className="text-muted-foreground">
              Parts listed here ship from your shelves. Owners and mechanics
              see an "On hand" badge and skip the delivery step at checkout.
            </p>
          </div>
        </CardContent>
      </Card>

      {adding && (
        <NewPartForm centerId={center.id} onClose={() => setAdding(false)} />
      )}

      {partsError ? (
        <div className="py-12 text-center bg-destructive/5 rounded-lg border border-destructive/30 text-sm text-destructive">
          Couldn't load your shop inventory: {partsError.message}
        </div>
      ) : isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : !parts || parts.length === 0 ? (
        <div className="py-16 text-center bg-muted/30 rounded-lg border border-dashed">
          <Package className="h-10 w-10 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-muted-foreground mb-4">
            No parts in your shop yet.
          </p>
          {!adding && (
            <Button onClick={() => setAdding(true)}>Add your first part</Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {parts.map((p) => (
            <Card key={p.id}>
              <CardContent className="p-4 flex items-start gap-4 flex-wrap">
                <div className="w-20 h-20 rounded-md bg-muted overflow-hidden flex-shrink-0 flex items-center justify-center">
                  {p.imageUrl ? (
                    <img
                      src={resolveImageUrl(p.imageUrl)}
                      alt={p.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Package className="h-6 w-6 text-muted-foreground/40" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <Badge variant="secondary" className="text-xs">
                      {p.category}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {p.brand}
                    </Badge>
                    {!p.active && (
                      <Badge className="text-xs bg-gray-200 text-gray-700">
                        Unlisted
                      </Badge>
                    )}
                    {p.active && p.stock <= 5 && p.stock > 0 && (
                      <Badge className="text-xs bg-amber-500 text-white">
                        Low stock
                      </Badge>
                    )}
                    {p.active && p.stock === 0 && (
                      <Badge className="text-xs bg-gray-700 text-white">
                        Out of stock
                      </Badge>
                    )}
                  </div>
                  <p className="font-semibold">{p.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {p.sku}
                  </p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    List price {formatCurrency(p.price)}
                  </p>
                </div>
                <StockEditor part={p} centerId={center.id} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
