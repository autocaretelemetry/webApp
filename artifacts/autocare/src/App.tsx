import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/AppShell";
import { useRole } from "@/lib/role";
import NotFound from "@/pages/not-found";

// Owner Pages
import OwnerDashboard from "@/pages/owner/Dashboard";
import Vehicles from "@/pages/owner/Vehicles";
import NewVehicle from "@/pages/owner/NewVehicle";
import VehicleDetail from "@/pages/owner/VehicleDetail";
import ServiceCenters from "@/pages/owner/ServiceCenters";
import ServiceCenterDetail from "@/pages/owner/ServiceCenterDetail";
import Book from "@/pages/owner/Book";

// Center Pages
import CenterDashboard from "@/pages/center/Dashboard";
import Jobs from "@/pages/center/Jobs";
import Mechanics from "@/pages/center/Mechanics";

// Shared Pages
import Bookings from "@/pages/shared/Bookings";
import BookingDetail from "@/pages/shared/BookingDetail";
import InvoiceDetail from "@/pages/shared/InvoiceDetail";
import Settings from "@/pages/Settings";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  const { role } = useRole();

  return (
    <AppShell>
      <Switch>
        {/* Dashboards conditionally render on root */}
        <Route path="/">
          {role === "owner" ? <OwnerDashboard /> : <CenterDashboard />}
        </Route>

        {/* Owner Routes */}
        <Route path="/vehicles" component={Vehicles} />
        <Route path="/vehicles/new" component={NewVehicle} />
        <Route path="/vehicles/:id" component={VehicleDetail} />
        <Route path="/service-centers" component={ServiceCenters} />
        <Route path="/service-centers/:id" component={ServiceCenterDetail} />
        <Route path="/book" component={Book} />

        {/* Center Routes */}
        <Route path="/jobs" component={Jobs} />
        <Route path="/mechanics" component={Mechanics} />

        {/* Shared Routes */}
        <Route path="/bookings" component={Bookings} />
        <Route path="/bookings/:id" component={BookingDetail} />
        <Route path="/invoices/:id" component={InvoiceDetail} />
        <Route path="/settings" component={Settings} />

        <Route component={NotFound} />
      </Switch>
    </AppShell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster position="bottom-right" richColors />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
