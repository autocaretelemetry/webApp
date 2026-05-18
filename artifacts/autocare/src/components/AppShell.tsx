import { type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useRole } from "@/lib/role";
import { cn } from "@/lib/utils";
import { 
  Car, 
  Wrench, 
  LayoutDashboard, 
  Settings, 
  CalendarDays,
  Users,
  Store,
  FileText
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";

const OWNER_NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/vehicles", label: "My Vehicles", icon: Car },
  { href: "/service-centers", label: "Service Centers", icon: Store },
  { href: "/bookings", label: "Bookings", icon: CalendarDays },
];

const CENTER_NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/jobs", label: "Jobs", icon: Wrench },
  { href: "/mechanics", label: "Mechanics", icon: Users },
  { href: "/bookings", label: "All Bookings", icon: CalendarDays },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { role, setRole } = useRole();
  const [location] = useLocation();

  const navItems = role === "owner" ? OWNER_NAV : CENTER_NAV;

  return (
    <div className="flex min-h-screen bg-background flex-col md:flex-row">
      {/* Mobile Top Bar */}
      <header className="md:hidden flex items-center justify-between p-4 border-b bg-card">
        <div className="flex items-center gap-2 text-primary font-bold text-xl">
          <Wrench className="h-6 w-6" />
          <span>AutoCare</span>
        </div>
        <Tabs value={role} onValueChange={(v) => setRole(v as "owner" | "center")} className="w-[200px]">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="owner">Owner</TabsTrigger>
            <TabsTrigger value="center">Center</TabsTrigger>
          </TabsList>
        </Tabs>
      </header>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 flex-col border-r bg-sidebar p-4 gap-6">
        <div className="flex items-center gap-2 text-primary font-bold text-2xl px-2">
          <Wrench className="h-8 w-8" />
          <span>AutoCare</span>
        </div>

        <Tabs value={role} onValueChange={(v) => setRole(v as "owner" | "center")} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="owner">Owner</TabsTrigger>
            <TabsTrigger value="center">Center</TabsTrigger>
          </TabsList>
        </Tabs>

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
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
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
            <span className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors cursor-pointer text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              location === "/settings" && "bg-sidebar-accent text-sidebar-accent-foreground"
            )}>
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
                      : "text-sidebar-foreground hover:bg-sidebar-accent"
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
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
