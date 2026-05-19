import { Link } from "wouter";
import {
  Wrench,
  Car,
  Building2,
  Truck,
  Package,
  ShieldCheck,
  ArrowRight,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const ROLES = [
  {
    icon: Car,
    title: "Vehicle owners",
    desc: "Track every car you own, book service from trusted centers, and approve invoices before you pay.",
  },
  {
    icon: Building2,
    title: "Service centers",
    desc: "Triage incoming requests, assign mechanics, and bill customers — all from one operations board.",
  },
  {
    icon: Package,
    title: "Parts vendors",
    desc: "List parts to a connected marketplace and fulfill orders from owners and centers in one place.",
  },
  {
    icon: Truck,
    title: "Delivery agents",
    desc: "Pick up parts orders, run routes, and update statuses on the go.",
  },
  {
    icon: ShieldCheck,
    title: "Platform admins",
    desc: "Onboard centers, vendors, and agents; manage plans, subscriptions, and revenue.",
  },
];

const FEATURES = [
  "Time + mileage service reminders, delivered in-app and via push",
  "WhatsApp alerts to centers for new jobs, approved invoices, and payments",
  "Booking lifecycle protected by a finite-state machine, end-to-end",
  "Connected marketplace for parts, with cart and checkout for both owners and centers",
  "Peer-to-peer car rentals with KYC, KYV, and admin moderation",
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary font-bold text-xl">
            <Wrench className="h-6 w-6" />
            <span>AutoCare</span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login">
              <Button variant="ghost">Sign in</Button>
            </Link>
            <Link href="/login">
              <Button>Get started</Button>
            </Link>
          </div>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-6 pt-16 pb-12 text-center space-y-6">
        <div className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground border rounded-full px-3 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          Connected automotive service platform
        </div>
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight max-w-3xl mx-auto leading-[1.05]">
          One platform for every side of your garage.
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
          AutoCare pairs vehicle owners with service centers, parts vendors,
          and delivery agents. Track maintenance, book service, approve
          invoices, and keep the whole workshop moving — without leaving the
          app.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link href="/login">
            <Button size="lg" className="gap-2">
              Sign in to your account <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-12">
        <h2 className="text-2xl font-bold mb-8 text-center">Built for every role</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {ROLES.map((r) => {
            const Icon = r.icon;
            return (
              <Card key={r.title} className="border-border/60">
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
            <h2 className="text-3xl font-bold mb-4">
              Everything you need to run the workshop.
            </h2>
            <p className="text-muted-foreground mb-6">
              From the first request to the final receipt, AutoCare keeps
              owners, centers, vendors, and agents on the same page.
            </p>
            <ul className="space-y-3">
              {FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm">
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
              <h3 className="font-semibold text-lg">Demo accounts</h3>
              <p className="text-sm text-muted-foreground">
                Pick a role and sign in to try AutoCare end-to-end.
              </p>
              <div className="divide-y rounded-md border bg-card">
                {[
                  ["Owner", "owner@autocare.test", "owner1234"],
                  ["Service center", "center@autocare.test", "center1234"],
                  ["Vendor", "vendor@autocare.test", "vendor1234"],
                  ["Delivery agent", "delivery@autocare.test", "delivery1234"],
                  ["Admin", "admin@autocare.test", "admin1234"],
                  ["Super admin", "superadmin@autocare.test", "super1234"],
                ].map(([label, email, pw]) => (
                  <div
                    key={email}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                  >
                    <span className="font-medium">{label}</span>
                    <code className="text-[11px] text-muted-foreground">
                      {email} / {pw}
                    </code>
                  </div>
                ))}
              </div>
              <Link href="/login">
                <Button className="w-full">Open sign in</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </section>

      <footer className="border-t mt-12">
        <div className="max-w-6xl mx-auto px-6 py-6 text-xs text-muted-foreground flex items-center justify-between">
          <span>© AutoCare. All rights reserved.</span>
          <Link href="/login">
            <span className="hover:text-foreground cursor-pointer">Sign in</span>
          </Link>
        </div>
      </footer>
    </div>
  );
}
