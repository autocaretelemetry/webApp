import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useRole, type Role } from "@/lib/role";
import { useCart } from "@/lib/cart";
import { cn } from "@/lib/utils";
import { NotificationBell } from "@/components/NotificationBell";
import { useAuth } from "@/lib/auth";
import { resolveImageUrl } from "@/lib/format";
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
  Menu,
  X,
  LogOut,
  UserCircle2,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronRight,
  Paintbrush,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AuthedUser } from "@workspace/api-client-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

type NavSection = {
  label: string;
  items: NavItem[];
};

const OWNER_NAV: NavSection[] = [
  {
    label: "Workshop",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/vehicles", label: "My Vehicles", icon: Car },
      { href: "/service-centers", label: "Service Centers", icon: Store },
      { href: "/bookings", label: "Bookings", icon: CalendarDays },
    ],
  },
  {
    label: "Rentals",
    items: [
      { href: "/rentals", label: "Rent a Car", icon: KeyRound },
      { href: "/rentals/my-bookings", label: "My Rentals", icon: CalendarDays },
      { href: "/rentals/profile", label: "Renter Profile", icon: UserCircle2 },
      { href: "/rentals/my-listings", label: "My Listings", icon: Layers },
      { href: "/rentals/listing-requests", label: "Requests on my cars", icon: ShieldCheck },
    ],
  },
  {
    label: "Parts",
    items: [
      { href: "/marketplace", label: "Marketplace", icon: ShoppingBag },
      { href: "/orders", label: "My Orders", icon: Package },
    ],
  },
];

const CENTER_NAV: NavSection[] = [
  {
    label: "Operations",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/jobs", label: "Jobs", icon: Wrench },
      { href: "/mechanics", label: "Mechanics", icon: Users },
      { href: "/bookings", label: "All Bookings", icon: CalendarDays },
    ],
  },
  {
    label: "Business",
    items: [
      { href: "/center/retainer-plans", label: "Retainer Plans", icon: ShieldCheck },
      { href: "/marketplace", label: "Parts Marketplace", icon: ShoppingBag },
      { href: "/orders", label: "Parts Orders", icon: Package },
    ],
  },
  {
    label: "Team",
    items: [
      { href: "/center/staff", label: "Staff", icon: UserCog },
    ],
  },
];

const VENDOR_NAV: NavSection[] = [
  {
    label: "Catalog",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/vendor/parts", label: "My Catalog", icon: Package },
      { href: "/vendor/orders", label: "Fulfillment", icon: ShoppingBag },
      { href: "/vendor/delivery-team", label: "Delivery Team", icon: Truck },
      { href: "/vendor/staff", label: "Staff", icon: UserCog },
      { href: "/marketplace", label: "Browse", icon: Store },
    ],
  },
];

const DELIVERY_NAV: NavSection[] = [
  {
    label: "On the road",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/delivery/orders", label: "My Deliveries", icon: Truck },
      { href: "/delivery/register", label: "Profile", icon: UserPlus },
    ],
  },
];

const ADMIN_NAV: NavSection[] = [
  {
    label: "Overview",
    items: [
      { href: "/", label: "Overview", icon: LayoutDashboard },
      { href: "/admin/revenue", label: "Revenue", icon: TrendingUp },
    ],
  },
  {
    label: "Billing",
    items: [
      { href: "/admin/subscriptions", label: "Subscriptions", icon: CreditCard },
      { href: "/admin/plans", label: "Plans", icon: Layers },
    ],
  },
  {
    label: "Network",
    items: [
      { href: "/admin/staff", label: "Platform Staff", icon: UserCog },
      { href: "/admin/centers", label: "Service Centers", icon: Building2 },
      { href: "/admin/vendors", label: "Vendors", icon: Store },
      { href: "/admin/mechanics", label: "Mechanics", icon: Users },
      { href: "/admin/agents", label: "Delivery Agents", icon: Truck },
      { href: "/admin/rentals", label: "Rentals", icon: KeyRound },
    ],
  },
  {
    label: "Activity",
    items: [
      { href: "/bookings", label: "All Bookings", icon: CalendarDays },
      { href: "/orders", label: "All Orders", icon: Package },
    ],
  },
];

const SUPER_ADMIN_NAV: NavSection[] = [
  ...ADMIN_NAV,
  {
    label: "Site",
    items: [
      { href: "/super-admin/landing", label: "Landing Page", icon: Paintbrush },
    ],
  },
];

function navFor(role: Role, isSuperAdmin: boolean): NavSection[] {
  const base = (() => {
    if (role === "owner") return OWNER_NAV;
    if (role === "center") return CENTER_NAV;
    if (role === "vendor") return VENDOR_NAV;
    if (role === "admin") return ADMIN_NAV;
    if (role === "super_admin") return SUPER_ADMIN_NAV;
    return DELIVERY_NAV;
  })();
  // The Landing Page editor is a super-admin tool that should be reachable
  // no matter which role the super admin is currently impersonating.
  if (isSuperAdmin && role !== "super_admin") {
    return [
      ...base,
      {
        label: "Site",
        items: [
          { href: "/super-admin/landing", label: "Landing Page", icon: Paintbrush },
        ],
      },
    ];
  }
  return base;
}

function CartButton({ collapsed = false }: { collapsed?: boolean }) {
  const { itemCount, scope } = useCart();
  return (
    <Link href="/cart">
      <span
        className={cn(
          "relative inline-flex items-center justify-center rounded-md hover:bg-sidebar-accent cursor-pointer transition-colors",
          collapsed ? "h-9 w-9" : "h-9 w-9",
        )}
      >
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
  showSuperAdmin = false,
  className,
  triggerClassName,
}: {
  role: Role;
  setRole: (r: Role) => void;
  showSuperAdmin?: boolean;
  className?: string;
  triggerClassName?: string;
}) {
  const tabs: { value: Role; label: string; icon?: LucideIcon }[] = [
    { value: "owner", label: "Owner" },
    { value: "center", label: "Center" },
    { value: "vendor", label: "Vendor" },
    { value: "delivery", label: "Delivery" },
    { value: "admin", label: "Admin", icon: ShieldCheck },
  ];
  if (showSuperAdmin) {
    tabs.push({ value: "super_admin", label: "Super", icon: Paintbrush });
  }
  return (
    <Tabs value={role} onValueChange={(v) => setRole(v as Role)} className={className}>
      <TabsList className={cn("grid w-full", showSuperAdmin ? "grid-cols-6" : "grid-cols-5")}>
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <TabsTrigger key={t.value} value={t.value} className={triggerClassName}>
              {Icon ? (
                <span className="inline-flex items-center gap-0.5">
                  <Icon className="h-3 w-3" />
                  {t.label}
                </span>
              ) : (
                t.label
              )}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}

const ROLE_LABEL: Record<Role, string> = {
  owner: "Vehicle owner",
  center: "Service center",
  vendor: "Parts vendor",
  delivery: "Delivery agent",
  admin: "Platform admin",
  super_admin: "Super admin",
};

function SidebarItem({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const content = (
    <Link href={item.href} onClick={onNavigate}>
      <span
        className={cn(
          "group relative flex items-center gap-3 rounded-md text-sm font-medium transition-all cursor-pointer",
          collapsed ? "justify-center h-10 w-10 mx-auto" : "px-3 py-2",
          active
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:translate-x-0.5",
        )}
      >
        {/* Active indicator bar */}
        {active && !collapsed && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-r bg-primary-foreground/80" />
        )}
        <Icon className={cn("h-4 w-4 shrink-0 transition-transform", active && "scale-110")} />
        {!collapsed && <span className="truncate">{item.label}</span>}
        {!collapsed && active && (
          <ChevronRight className="ml-auto h-3.5 w-3.5 opacity-70" />
        )}
      </span>
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {item.label}
        </TooltipContent>
      </Tooltip>
    );
  }
  return content;
}

function SidebarBody({
  role,
  setRole,
  user,
  logout,
  collapsed,
  canSwitchRole,
  location,
  onNavigate,
}: {
  role: Role;
  setRole: (r: Role) => void;
  user: AuthedUser | null;
  logout: () => void | Promise<void>;
  collapsed: boolean;
  canSwitchRole: boolean;
  location: string;
  onNavigate?: () => void;
}) {
  const sections = navFor(role, user?.role === "super_admin");
  const showCart = role === "owner" || role === "center";
  const showBell = role === "owner";

  return (
    <div className="flex h-full flex-col bg-sidebar">
      {/* Branding */}
      <div
        className={cn(
          "flex items-center border-b border-sidebar-border/60",
          collapsed ? "justify-center h-16 px-2" : "justify-between gap-2 h-16 px-4",
        )}
      >
        <Link href="/" onClick={onNavigate}>
          <div className="flex items-center gap-2 text-primary font-bold cursor-pointer">
            <div className="relative h-9 w-9 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shadow-sm">
              <Wrench className="h-5 w-5" />
            </div>
            {!collapsed && <span className="text-xl tracking-tight">AutoCare</span>}
          </div>
        </Link>
        {!collapsed && (
          <div className="flex items-center gap-1">
            {showBell && <NotificationBell />}
            {showCart && <CartButton />}
          </div>
        )}
      </div>

      {/* Collapsed quick actions */}
      {collapsed && (showBell || showCart) && (
        <div className="flex flex-col items-center gap-1 py-2 border-b border-sidebar-border/60">
          {showBell && <NotificationBell />}
          {showCart && <CartButton collapsed />}
        </div>
      )}

      {/* User chip */}
      {user && (
        <div className={cn("px-3 pt-3", collapsed && "px-2")}>
          {collapsed ? (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Link href="/profile">
                  <div className="flex items-center justify-center h-10 w-10 mx-auto rounded-full bg-primary/10 text-primary font-semibold uppercase overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary/40 transition">
                    {user.avatarUrl ? (
                      <img
                        src={resolveImageUrl(user.avatarUrl)}
                        alt={user.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      user.name.charAt(0)
                    )}
                  </div>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                <div className="text-xs">
                  <div className="font-semibold">{user.name}</div>
                  <div className="text-muted-foreground">{ROLE_LABEL[user.role as Role]}</div>
                </div>
              </TooltipContent>
            </Tooltip>
          ) : (
            <div className="rounded-lg border border-sidebar-border/60 bg-card/60 px-3 py-2.5 flex items-center gap-2.5">
              <Link
                href="/profile"
                onClick={onNavigate}
                className="flex items-center gap-2.5 flex-1 min-w-0 hover:opacity-80 transition"
              >
                <div className="h-9 w-9 rounded-full bg-primary/10 text-primary font-semibold uppercase flex items-center justify-center shrink-0 overflow-hidden">
                  {user.avatarUrl ? (
                    <img
                      src={resolveImageUrl(user.avatarUrl)}
                      alt={user.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    user.name.charAt(0)
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{user.name}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">
                    {ROLE_LABEL[user.role as Role]}
                  </div>
                </div>
              </Link>
              <button
                aria-label="Sign out"
                onClick={() => void logout()}
                className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted text-muted-foreground transition-colors shrink-0"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Role switcher (super admin only) */}
      {canSwitchRole && !collapsed && (
        <div className="px-3 pt-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5 px-1">
            Impersonate
          </div>
          <RoleTabs
            role={role}
            setRole={setRole}
            showSuperAdmin
            className="w-full"
            triggerClassName="text-[10px] px-0.5"
          />
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-4">
        {sections.map((section, idx) => (
          <div key={idx} className="space-y-1">
            {!collapsed && (
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground px-2 pb-1">
                {section.label}
              </div>
            )}
            {collapsed && idx > 0 && (
              <div className="h-px bg-sidebar-border/60 my-2 mx-2" />
            )}
            <div className={cn("flex flex-col", collapsed ? "gap-1.5 items-center" : "gap-0.5")}>
              {section.items.map((item) => {
                const isActive =
                  location === item.href ||
                  (item.href !== "/" && location.startsWith(item.href));
                return (
                  <SidebarItem
                    key={item.href}
                    item={item}
                    active={isActive}
                    collapsed={collapsed}
                    onNavigate={onNavigate}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className={cn("border-t border-sidebar-border/60 p-3 space-y-0.5", collapsed && "px-2")}>
        <SidebarItem
          item={{ href: "/profile", label: "My Profile", icon: UserCircle2 }}
          active={location === "/profile"}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
        <SidebarItem
          item={{ href: "/settings", label: "Settings", icon: Settings }}
          active={location === "/settings"}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
      </div>
    </div>
  );
}

const COLLAPSED_KEY = "autocare_sidebar_collapsed";

export function AppShell({ children }: { children: ReactNode }) {
  const { role, setRole } = useRole();
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  });

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  const canSwitchRole = user?.role === "super_admin";

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar — animated width collapse */}
      <aside
        className={cn(
          "hidden md:flex shrink-0 border-r border-sidebar-border/60 bg-sidebar relative transition-[width] duration-300 ease-out",
          collapsed ? "w-[72px]" : "w-64",
        )}
      >
        <div className="w-full">
          <SidebarBody
            role={role}
            setRole={setRole}
            user={user}
            logout={logout}
            collapsed={collapsed}
            canSwitchRole={canSwitchRole}
            location={location}
          />
        </div>

        {/* Collapse toggle — sits on the seam between sidebar and content */}
        <button
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setCollapsed((c) => !c)}
          className="absolute -right-3 top-20 z-10 h-6 w-6 rounded-full border border-sidebar-border/60 bg-card text-muted-foreground shadow-sm hover:text-foreground hover:bg-accent flex items-center justify-center transition-colors"
        >
          {collapsed ? (
            <PanelLeftOpen className="h-3.5 w-3.5" />
          ) : (
            <PanelLeftClose className="h-3.5 w-3.5" />
          )}
        </button>
      </aside>

      {/* Mobile slide-out sheet */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="p-0 w-72 max-w-[85vw] bg-sidebar border-r border-sidebar-border/60"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarBody
            role={role}
            setRole={setRole}
            user={user}
            logout={logout}
            collapsed={false}
            canSwitchRole={canSwitchRole}
            location={location}
            onNavigate={() => setMobileOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* Main content area */}
      <main className="flex-1 flex flex-col min-h-screen min-w-0">
        {/* Mobile top bar */}
        <header className="md:hidden sticky top-0 z-30 flex items-center justify-between gap-2 px-4 h-14 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <div className="flex items-center gap-2">
            <button
              aria-label="Open menu"
              onClick={() => setMobileOpen(true)}
              className="h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-accent transition-colors"
            >
              <Menu className="h-5 w-5" />
            </button>
            <Link href="/">
              <div className="flex items-center gap-1.5 text-primary font-bold cursor-pointer">
                <Wrench className="h-5 w-5" />
                <span>AutoCare</span>
              </div>
            </Link>
          </div>
          <div className="flex items-center gap-1">
            {role === "owner" && <NotificationBell />}
            {(role === "owner" || role === "center") && <CartButton />}
            {user && (
              <button
                aria-label="Sign out"
                onClick={() => void logout()}
                className="h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-accent transition-colors"
                title={`${user.name} — sign out`}
              >
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-6xl mx-auto">{children}</div>
        </div>
      </main>
    </div>
  );
}
