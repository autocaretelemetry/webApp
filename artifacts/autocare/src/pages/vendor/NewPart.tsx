import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useListVendors, useCreatePart } from "@workspace/api-client-react";
import {
  getListPartsForVendorQueryKey,
  getListPartsQueryKey,
  getListPartCategoriesQueryKey,
} from "@/lib/queryKeys";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

const CATEGORY_SUGGESTIONS = ["Brakes", "Engine", "Suspension", "Body", "Electrical", "Fluids", "Filters", "Performance", "Tires", "Interior"];

export default function NewPart() {
  const [, navigate] = useLocation();
  const { data: vendors } = useListVendors();
  const vendor = vendors?.[0];
  const createPart = useCreatePart();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Brakes");
  const [brand, setBrand] = useState("");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState(0);
  const [stock, setStock] = useState(1);
  const [imageUrl, setImageUrl] = useState("");
  const [compat, setCompat] = useState("");

  if (!vendor) return <div className="p-8">Loading...</div>;

  const submit = async () => {
    if (!name.trim() || !description.trim() || !brand.trim() || !sku.trim()) {
      toast.error("Please fill in name, description, brand, and SKU.");
      return;
    }
    if (price <= 0) {
      toast.error("Price must be greater than zero.");
      return;
    }
    try {
      await createPart.mutateAsync({
        vendorId: vendor.id,
        data: {
          name: name.trim(),
          description: description.trim(),
          category: category.trim(),
          brand: brand.trim(),
          sku: sku.trim(),
          price,
          stock,
          imageUrl: imageUrl.trim() || null,
          compatibleBrands: compat
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListPartsForVendorQueryKey(vendor.id) }),
        queryClient.invalidateQueries({ queryKey: getListPartsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListPartCategoriesQueryKey() }),
      ]);
      toast.success("Part added to catalog.");
      navigate("/vendor/parts");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create part.");
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500 max-w-3xl">
      <Button variant="ghost" size="sm" onClick={() => navigate("/vendor/parts")} className="gap-1.5">
        <ArrowLeft className="h-4 w-4" /> Back to catalog
      </Button>
      <PageHeader title="Add a new part" description="List a part on the marketplace." />

      <Card>
        <CardContent className="p-6 space-y-4">
          <div>
            <Label htmlFor="name">Part name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" placeholder="e.g. Ceramic Brake Pad Set" />
          </div>
          <div>
            <Label htmlFor="desc">Description</Label>
            <Textarea id="desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1.5" placeholder="What it is, what makes it good, what it fits." />
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="cat">Category</Label>
              <select
                id="cat"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1.5 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                {CATEGORY_SUGGESTIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="brand">Brand</Label>
              <Input id="brand" value={brand} onChange={(e) => setBrand(e.target.value)} className="mt-1.5" placeholder="e.g. Bosch" />
            </div>
            <div>
              <Label htmlFor="sku">SKU</Label>
              <Input id="sku" value={sku} onChange={(e) => setSku(e.target.value)} className="mt-1.5" placeholder="e.g. BSH-BP-001" />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="price">Price (USD)</Label>
              <Input id="price" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(Number(e.target.value))} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="stock">Stock on hand</Label>
              <Input id="stock" type="number" min={0} value={stock} onChange={(e) => setStock(Math.max(0, Math.floor(Number(e.target.value))))} className="mt-1.5" />
            </div>
          </div>
          <div>
            <Label htmlFor="img">Image URL (optional)</Label>
            <Input id="img" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} className="mt-1.5" placeholder="https://..." />
          </div>
          <div>
            <Label htmlFor="compat">Compatible vehicle brands (comma-separated)</Label>
            <Input id="compat" value={compat} onChange={(e) => setCompat(e.target.value)} className="mt-1.5" placeholder="Ford, Toyota, BMW" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => navigate("/vendor/parts")}>Cancel</Button>
            <Button onClick={submit} disabled={createPart.isPending}>
              {createPart.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "List part"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
