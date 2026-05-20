import type { ComponentType } from "react";
import { Switch, Route, Router as WouterRouter, Link, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/AppShell";
import { useRole, type Role } from "@/lib/role";
import { AuthProvider, useAuth } from "@/lib/auth";
import Landing from "@/pages/Landing";
import LoginPage from "@/pages/Login";
import RentalsSignup from "@/pages/rentals/Signup";
import RegisterFleet from "@/pages/RegisterFleet";
import NotFound from "@/pages/not-found";

// Fleet Pages
import FleetDashboard from "@/pages/fleet/Dashboard";
import FleetVehiclesPage from "@/pages/fleet/Vehicles";
import FleetDriversPage from "@/pages/fleet/Drivers";
import FleetCentersPage from "@/pages/fleet/Centers";
import FleetSettingsPage from "@/pages/fleet/Settings";
import FleetSafetyPage from "@/pages/fleet/Safety";

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
import CenterRetainerPlans from "@/pages/center/RetainerPlans";

// Vendor Pages
import VendorDashboard from "@/pages/vendor/Dashboard";
import VendorParts from "@/pages/vendor/Parts";
import NewPart from "@/pages/vendor/NewPart";
import VendorOrders from "@/pages/vendor/Orders";
import VendorDeliveryTeam from "@/pages/vendor/DeliveryTeam";
import VendorStaff from "@/pages/vendor/Staff";
import ProfilePage from "@/pages/shared/Profile";
import CenterStaffPage from "@/pages/center/Staff";

// Delivery Pages
import DeliveryDashboard from "@/pages/delivery/Dashboard";
import DeliveryRegister from "@/pages/delivery/Register";
import DeliveryOrders from "@/pages/delivery/Orders";

// Admin Pages
import AdminDashboard from "@/pages/admin/Dashboard";
import AdminServiceCenters from "@/pages/admin/ServiceCenters";
import AdminVendors from "@/pages/admin/Vendors";
import AdminMechanics from "@/pages/admin/Mechanics";
import AdminDeliveryAgents from "@/pages/admin/DeliveryAgents";
import AdminStaff from "@/pages/admin/Staff";
import AdminPlans from "@/pages/admin/Plans";
import AdminSubscriptions from "@/pages/admin/Subscriptions";
import AdminRevenue from "@/pages/admin/Revenue";
import SuperAdminLandingEditor from "@/pages/super_admin/LandingEditor";
import AdminRentals from "@/pages/admin/Rentals";
import AdminRenters from "@/pages/admin/Renters";
import AdminSafety from "@/pages/admin/Safety";

// Rentals Pages
import RentalsBrowse from "@/pages/rentals/Browse";
import RentalDetail from "@/pages/rentals/Detail";
import ListYourCar from "@/pages/rentals/ListYours";
import MyListings from "@/pages/rentals/MyListings";
import MyRentals from "@/pages/rentals/MyRentals";
import RenterProfilePage from "@/pages/rentals/Profile";
import DriversPage from "@/pages/rentals/Drivers";
import ListingRequests from "@/pages/rentals/ListingRequests";
import SharedCar from "@/pages/rentals/SharedCar";

// Shared Pages
import Bookings from "@/pages/shared/Bookings";
import BookingDetail from "@/pages/shared/BookingDetail";
import InvoiceDetail from "@/pages/shared/InvoiceDetail";
import Marketplace from "@/pages/shared/Marketplace";
import PartDetail from "@/pages/shared/PartDetail";
import Cart from "@/pages/shared/Cart";
import Checkout from "@/pages/shared/Checkout";
import Orders from "@/pages/shared/Orders";
import OrderDetail from "@/pages/shared/OrderDetail";
import Settings from "@/pages/Settings";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function HomeRoute() {
  const { role } = useRole();
  if (role === "owner") return <OwnerDashboard />;
  if (role === "center") return <CenterDashboard />;
  if (role === "vendor") return <VendorDashboard />;
  if (role === "fleet") return <FleetDashboard />;
  if (role === "admin" || role === "super_admin") return <AdminDashboard />;
  return <DeliveryDashboard />;
}

function RoleGuard({
  allow,
  component: Component,
}: {
  allow: Role[];
  component: ComponentType;
}) {
  const { role } = useRole();
  if (!allow.includes(role)) {
    return (
      <div className="py-20 text-center space-y-4 animate-in fade-in-50">
        <p className="text-lg font-medium">This page isn't available for your current role.</p>
        <p className="text-sm text-muted-foreground">
          Switch roles from the top bar, or head back home.
        </p>
        <Link href="/">
          <Button>Go home</Button>
        </Link>
      </div>
    );
  }
  return <Component />;
}

const ownerOnly = (c: ComponentType) => () => <RoleGuard allow={["owner"]} component={c} />;
const centerOnly = (c: ComponentType) => () => <RoleGuard allow={["center"]} component={c} />;
const vendorOnly = (c: ComponentType) => () => <RoleGuard allow={["vendor"]} component={c} />;
const buyersOnly = (c: ComponentType) => () => <RoleGuard allow={["owner", "center", "fleet"]} component={c} />;
const deliveryOnly = (c: ComponentType) => () => <RoleGuard allow={["delivery"]} component={c} />;
const fleetOnly = (c: ComponentType) => () => <RoleGuard allow={["fleet"]} component={c} />;
const adminOnly = (c: ComponentType) => () => <RoleGuard allow={["admin", "super_admin"]} component={c} />;
const superAdminOnly = (c: ComponentType) => () => <RoleGuard allow={["super_admin"]} component={c} />;

function AppRouter() {
  return (
    <AppShell>
          <Switch>
            <Route path="/" component={HomeRoute} />

        {/* Owner Routes */}
        <Route path="/vehicles" component={ownerOnly(Vehicles)} />
        <Route path="/vehicles/new" component={ownerOnly(NewVehicle)} />
        <Route path="/vehicles/:id" component={ownerOnly(VehicleDetail)} />
        <Route path="/service-centers" component={ownerOnly(ServiceCenters)} />
        <Route
          path="/service-centers/:id"
          component={() => <RoleGuard allow={["owner", "admin"]} component={ServiceCenterDetail} />}
        />
        <Route path="/book" component={ownerOnly(Book)} />

        {/* Center Routes */}
        <Route path="/jobs" component={centerOnly(Jobs)} />
        <Route path="/mechanics" component={centerOnly(Mechanics)} />
        <Route path="/center/retainer-plans" component={centerOnly(CenterRetainerPlans)} />

        {/* Vendor Routes */}
        <Route path="/vendor/parts/new" component={vendorOnly(NewPart)} />
        <Route path="/vendor/parts" component={vendorOnly(VendorParts)} />
        <Route path="/vendor/orders" component={vendorOnly(VendorOrders)} />
        <Route path="/vendor/delivery-team" component={vendorOnly(VendorDeliveryTeam)} />
        <Route path="/vendor/staff" component={vendorOnly(VendorStaff)} />

        {/* Delivery Routes */}
        <Route path="/delivery/register" component={deliveryOnly(DeliveryRegister)} />
        <Route path="/delivery/orders" component={deliveryOnly(DeliveryOrders)} />

        {/* Fleet Routes */}
        <Route path="/fleet/vehicles" component={fleetOnly(FleetVehiclesPage)} />
        <Route path="/fleet/drivers" component={fleetOnly(FleetDriversPage)} />
        <Route path="/fleet/centers" component={fleetOnly(FleetCentersPage)} />
        <Route path="/fleet/settings" component={fleetOnly(FleetSettingsPage)} />
        <Route path="/fleet/safety" component={fleetOnly(FleetSafetyPage)} />
        <Route path="/register-fleet" component={RegisterFleet} />

        {/* Admin Routes */}
        <Route path="/admin/centers" component={adminOnly(AdminServiceCenters)} />
        <Route path="/admin/vendors" component={adminOnly(AdminVendors)} />
        <Route path="/admin/mechanics" component={adminOnly(AdminMechanics)} />
        <Route path="/admin/agents" component={adminOnly(AdminDeliveryAgents)} />
        <Route path="/admin/staff" component={adminOnly(AdminStaff)} />
        <Route path="/admin/plans" component={adminOnly(AdminPlans)} />
        <Route path="/admin/subscriptions" component={adminOnly(AdminSubscriptions)} />
        <Route path="/admin/revenue" component={adminOnly(AdminRevenue)} />
        <Route path="/admin/rentals" component={adminOnly(AdminRentals)} />
        <Route path="/admin/renters" component={adminOnly(AdminRenters)} />
        <Route path="/admin/safety" component={adminOnly(AdminSafety)} />

        {/* Super Admin Routes */}
        <Route path="/super-admin/landing" component={superAdminOnly(SuperAdminLandingEditor)} />

        {/* Rentals Routes (owners + admins can browse; bookings open to any role using owner shell) */}
        <Route path="/rentals" component={RentalsBrowse} />
        <Route path="/rentals/list-yours" component={ownerOnly(ListYourCar)} />
        <Route path="/rentals/my-listings" component={ownerOnly(MyListings)} />
        <Route path="/rentals/my-bookings" component={ownerOnly(MyRentals)} />
        <Route path="/rentals/profile" component={ownerOnly(RenterProfilePage)} />
        <Route path="/rentals/drivers" component={ownerOnly(DriversPage)} />
        <Route path="/rentals/listing-requests" component={ownerOnly(ListingRequests)} />
        <Route path="/rentals/:id" component={RentalDetail} />

        {/* Marketplace (shared) */}
        <Route path="/marketplace" component={buyersOnly(Marketplace)} />
        <Route path="/marketplace/:id" component={PartDetail} />
        <Route path="/cart" component={buyersOnly(Cart)} />
        <Route path="/checkout" component={buyersOnly(Checkout)} />
        <Route path="/orders" component={Orders} />
        <Route path="/orders/:id" component={OrderDetail} />

        {/* Shared Routes */}
        <Route path="/bookings" component={Bookings} />
        <Route path="/bookings/:id" component={BookingDetail} />
        <Route path="/invoices/:id" component={InvoiceDetail} />
        <Route path="/settings" component={Settings} />
        <Route path="/profile" component={ProfilePage} />
        <Route path="/center/staff" component={centerOnly(CenterStaffPage)} />

            <Route component={NotFound} />
          </Switch>
        </AppShell>
  );
}

function Router() {
  const { user, loading } = useAuth();
  return (
    <Switch>
      {/* Public share link — renders outside the app shell so non-platform
          visitors can view a single car without seeing the sidebar or any
          role-based navigation. */}
      <Route path="/share/cars/:id" component={SharedCar} />

      <Route path="/login" component={LoginPage} />
      <Route path="/rentals/signup" component={RentalsSignup} />
      <Route path="/register-fleet" component={RegisterFleet} />

      {loading ? (
        <Route>
          <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
            Loading AutoCare...
          </div>
        </Route>
      ) : user ? (
        <Route component={AppRouter} />
      ) : (
        <Switch>
          <Route path="/" component={Landing} />
          <Route>
            <Redirect to="/" />
          </Route>
        </Switch>
      )}
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster position="bottom-right" richColors />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
