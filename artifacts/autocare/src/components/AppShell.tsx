import { type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useRole, type Role } from "@/lib/role";
import { useCart } from "@/lib/cart";
import { cn } from "@/lib/utils";
import {
  Car,
  Wrench,
  LayoutDashboard,
  Settings,
  CalendarDays,
  Users,
  Store,
  ShoppingBag,
  Package,
  ShoppingCart,
  Truck,
  UserPlus,
  ShieldCheck,
  Building2,
  UserCog,
  Layers,
  CreditCard,
  TrendingUp,
  KeyRound,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const OWNER_NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/vehicles", label: "My Vehicles", icon: Car },
  { href: "/service-centers", label: "Service Centers", icon: Store },
  { href: "/bookings", label: "Bookings", icon: CalendarDays },
  { href: "/rentals", label: "Rent a Car", icon: KeyRound },
  { href: "/rentals/my-bookings", label: "My Rentals", icon: KeyRound },
  { href: "/rentals/profile", label: "Renter Profile", icon: KeyRound },
  { href: "/rentals/my-listings", label: "My Listings", icon: KeyRound },
  { href: "/rentals/listing-requests", label: "Requests on my cars", icon: KeyRound },
  { href: "/marketplace", label: "Marketplace", icon: ShoppingBag },
  { href: "/orders", label: "My Orders", icon: Package },
];

const CENTER_NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/jobs", label: "Jobs", icon: Wrench },
  { href: "/mechanics", label: "Mechanics", icon: Users },
  { href: "/bookings", label: "All Bookings", icon: CalendarDays },
  { href: "/marketplace", label: "Parts Marketplace", icon: ShoppingBag },
  { href: "/orders", label: "Parts Orders", icon: Package },
];

const VENDOR_NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/vendor/parts", label: "My Catalog", icon: Package },
  { href: "/vendor/orders", label: "Fulfillment", icon: ShoppingBag },
  { href: "/marketplace", label: "Browse", icon: Store },
];

const DELIVERY_NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/delivery/orders", label: "My Deliveries", icon: Truck },
  { href: "/delivery/register", label: "Profile", icon: UserPlus },
];

const ADMIN_NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/revenue", label: "Revenue", icon: TrendingUp },
  { href: "/admin/subscriptions", label: "Subscriptions", icon: CreditCard },
  { href: "/admin/plans", label: "Plans", icon: Layers },
  { href: "/admin/staff", label: "Platform Staff", icon: UserCog },
  { href: "/admin/centers", label: "Service Centers", icon: Building2 },
  { href: "/admin/vendors", label: "Vendors", icon: Store },
  { href: "/admin/mechanics", label: "Mechanics", icon: Users },
  { href: "/admin/agents", label: "Delivery Agents", icon: Truck },
  { href: "/admin/rentals", label: "Rentals", icon: KeyRound },
  { href: "/bookings", label: "All Bookings", icon: CalendarDays },
  { href: "/orders", label: "All Orders", icon: Package },
];

function navFor(role: Role) {
  if (role === "owner") return OWNER_NAV;
  if (role === "center") return CENTER_NAV;
  if (role === "vendor") return VENDOR_NAV;
  if (role === "admin") return ADMIN_NAV;
  return DELIVERY_NAV;
}

function CartButton() {
  const { itemCount, scope } = useCart();
  return (
    <Link href="/cart">
      <span className="relative inline-flex items-center justify-center rounded-md h-9 w-9 hover:bg-sidebar-accent cursor-pointer transition-colors">
        <ShoppingCart className="h-4 w-4" />
        {itemCount > 0 && (
          <span
            className={cn(
              "absolute -top-1 -right-1 inline-flex items-center justify-center rounded-full text-primary-foreground text-[10px] font-semibold h-4 min-w-4 px-1",
              scope ? "bg-indigo-600" : "bg-primary",
            )}
          >
            {itemCount}
          </span>
        )}
      </span>
    </Link>
  );
}

function RoleTabs({
  role,
  setRole,
  className,
  triggerClassName,
}: {
  role: Role;
  setRole: (r: Role) => void;
  className?: string;
  triggerClassName?: string;
}) {
  const tabs: { value: Role; label: string }[] = [
    { value: "owner", label: "Owner" },
    { value: "center", label: "Center" },
    { value: "vendor", label: "Vendor" },
    { value: "delivery", label: "Delivery" },
    { value: "admin", label: "Admin" },
  ];
  return (
    <Tabs value={role} onValueChange={(v) => setRole(v as Role)} className={className}>
      <TabsList className="grid w-full grid-cols-5">
        {tabs.map((t) => (
          <TabsTrigger key={t.value} value={t.value} className={triggerClassName}>
            {t.value === "admin" ? (
              <span className="inline-flex items-center gap-0.5">
                <ShieldCheck className="h-3 w-3" />
                {t.label}
              </span>
            ) : (
              t.label
            )}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { role, setRole } = useRole();
  const [location] = useLocation();

  const navItems = navFor(role);
  const showCart = role === "owner" || role === "center";

  return (
    <div className="flex min-h-screen bg-background flex-col md:flex-row">
      {/* Mobile Top Bar */}
      <header className="md:hidden flex items-center justify-between p-4 border-b bg-card gap-2">
        <div className="flex items-center gap-2 text-primary font-bold text-xl">
          <Wrench className="h-6 w-6" />
          <span>AutoCare</span>
        </div>
        <div className="flex items-center gap-2">
          {showCart && <CartButton />}
          <RoleTabs role={role} setRole={setRole} triggerClassName="text-[10px] px-1" />
        </div>
      </header>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 flex-col border-r bg-sidebar p-4 gap-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary font-bold text-2xl px-2">
            <Wrench className="h-8 w-8" />
            <span>AutoCare</span>
          </div>
          {showCart && <CartButton />}
        </div>

        <RoleTabs role={role} setRole={setRole} className="w-full" triggerClassName="text-[10px] px-0.5" />

        <nav className="flex flex-col gap-1 flex-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));

            return (
              <Link key={item.href} href={item.href}>
                <span
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
                    isActive
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto">
          <Link href="/settings">
            <span
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors cursor-pointer text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                location === "/settings" && "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
            >
              <Settings className="h-4 w-4" />
              Settings
            </span>
          </Link>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Mobile Navigation (Horizontal Scroll) */}
        <nav className="md:hidden flex overflow-x-auto p-2 border-b bg-sidebar gap-1 no-scrollbar">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));

            return (
              <Link key={item.href} href={item.href}>
                <span
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-6xl mx-auto">{children}</div>
        </div>
      </main>
    </div>
  );
}
