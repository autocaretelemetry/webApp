import { Link } from "wouter";
import {
  Wrench,
  Car,
  Building2,
  Truck,
  Package,
  ShieldCheck,
  Users,
  ArrowRight,
  Check,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useGetLandingContent } from "@workspace/api-client-react";
import { resolveImageUrl } from "@/lib/format";

// The design system stores --primary as HSL channels ("22 90% 50%") and
// resolves them with `hsl(var(--primary))`. The super-admin editor exposes
// a hex color picker, so convert hex -> HSL channel string here before
// writing the override.
function hexToHslChannels(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const int = parseInt(m[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

const ICON_MAP: Record<string, LucideIcon> = {
  car: Car,
  building: Building2,
  package: Package,
  truck: Truck,
  shield: ShieldCheck,
  wrench: Wrench,
  users: Users,
};

export default function Landing() {
  const { data: content, isLoading, isError } = useGetLandingContent();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (isError || !content) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-destructive">
        Couldn't load the landing page. Please refresh.
      </div>
    );
  }

  const logo = resolveImageUrl(content.logoUrl);
  const hero = resolveImageUrl(content.heroImageUrl);
  const primaryHsl = hexToHslChannels(content.primaryColor);

  return (
    <div
      className="min-h-screen bg-background text-foreground"
      // Override the design-system primary token *only* on the landing page
      // so super-admin color picks apply to buttons, accents, and icons
      // without leaking into the authenticated app shell. Tokens are HSL
      // channels (consumed via `hsl(var(--primary))`), so we convert from
      // the editor's hex value first. If the saved value isn't a valid hex,
      // we fall back to the design-system default by skipping the override.
      style={primaryHsl ? { ["--primary" as string]: primaryHsl } : undefined}
    >
      <header className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary font-bold text-xl">
            {logo ? (
              <img src={logo} alt={content.brandName} className="h-8 w-8 object-contain" />
            ) : (
              <Wrench className="h-6 w-6" />
            )}
            <span>{content.brandName}</span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login">
              <Button variant="ghost">{content.signInLabel}</Button>
            </Link>
            <Link href="/login">
              <Button>{content.getStartedLabel}</Button>
            </Link>
          </div>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-6 pt-16 pb-12 text-center space-y-6">
        <div className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground border rounded-full px-3 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          {content.heroEyebrow}
        </div>
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight max-w-3xl mx-auto leading-[1.05]">
          {content.heroTitle}
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
          {content.heroSubtitle}
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link href="/login">
            <Button size="lg" className="gap-2">
              {content.heroCtaLabel} <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
        {hero && (
          <div className="pt-8 max-w-4xl mx-auto">
            <img
              src={hero}
              alt=""
              className="w-full rounded-xl border shadow-sm object-cover max-h-[460px]"
            />
          </div>
        )}
      </section>

      <section className="max-w-6xl mx-auto px-6 py-12">
        <h2 className="text-2xl font-bold mb-8 text-center">{content.rolesHeading}</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {content.roles.map((r, i) => {
            const Icon = ICON_MAP[r.icon] ?? Wrench;
            return (
              <Card key={`${r.title}-${i}`} className="border-border/60">
                <CardContent className="pt-6 space-y-3">
                  <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-semibold">{r.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {r.desc}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-12">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="text-3xl font-bold mb-4">{content.featuresHeading}</h2>
            <p className="text-muted-foreground mb-6">{content.featuresSubtitle}</p>
            <ul className="space-y-3">
              {content.features.map((f, i) => (
                <li key={`${f}-${i}`} className="flex items-start gap-3 text-sm">
                  <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary shrink-0">
                    <Check className="h-3 w-3" />
                  </span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
          <Card className="bg-sidebar border-border/60">
            <CardContent className="pt-6 space-y-4">
              <h3 className="font-semibold text-lg">Get started</h3>
              <p className="text-sm text-muted-foreground">
                Create an account to join {content.brandName}, or sign in if you
                already have one. New applications are reviewed before access is
                granted.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Link href="/signup">
                  <Button className="w-full">Apply for access</Button>
                </Link>
                <Link href="/login">
                  <Button variant="outline" className="w-full">Sign in</Button>
                </Link>
              </div>
              <p className="text-xs text-muted-foreground">
                Just want to rent a car?{" "}
                <Link href="/rentals/signup">
                  <span className="text-primary font-medium hover:underline cursor-pointer">
                    Quick renter signup
                  </span>
                </Link>
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      <footer className="border-t mt-12">
        <div className="max-w-6xl mx-auto px-6 py-6 text-xs text-muted-foreground flex items-center justify-between">
          <span>{content.footerText}</span>
          <Link href="/login">
            <span className="hover:text-foreground cursor-pointer">
              {content.footerSignInLabel}
            </span>
          </Link>
        </div>
      </footer>
    </div>
  );
}
