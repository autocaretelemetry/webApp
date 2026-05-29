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
import SignupPage from "@/pages/Signup";
import RentalsSignup from "@/pages/rentals/Signup";
import RegisterFleet from "@/pages/RegisterFleet";
import OnboardingKyc from "@/pages/onboarding/Kyc";
import OnboardingRejected from "@/pages/onboarding/Rejected";
import NotFound from "@/pages/not-found";

// Fleet Pages
import FleetDashboard from "@/pages/fleet/Dashboard";
import FleetVehiclesPage from "@/pages/fleet/Vehicles";
import FleetDriversPage from "@/pages/fleet/Drivers";
import FleetCentersPage from "@/pages/fleet/Centers";
import FleetSettingsPage from "@/pages/fleet/Settings";
import FleetSafetyPage from "@/pages/fleet/Safety";
import FleetOrdersPage from "@/pages/fleet/Orders";

// Owner Pages
import OwnerDashboard from "@/pages/owner/Dashboard";

// Renter Pages
import RenterDashboard from "@/pages/renter/Dashboard";
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
import CenterShop from "@/pages/center/Shop";

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
import SuperAdminApprovals from "@/pages/super_admin/Approvals";
import SuperAdminOrganizations from "@/pages/super_admin/Organizations";
import SuperAdminOnboard from "@/pages/super_admin/Onboard";
import SuperAdminCommissions from "@/pages/super_admin/Commissions";
import SuperAdminPayouts from "@/pages/super_admin/Payouts";
import SuperAdminPayments from "@/pages/super_admin/Payments";
import SuperAdminFinance from "@/pages/super_admin/Finance";
import PayoutAccountPage from "@/pages/settings/PayoutAccount";
import AdminRentals from "@/pages/admin/Rentals";
import AdminRenters from "@/pages/admin/Renters";
import AdminOwners from "@/pages/admin/Owners";
import AdminReminderRuns from "@/pages/admin/ReminderRuns";
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

// Billing
import Subscribe from "@/pages/billing/Subscribe";
import PaymentResult from "@/pages/billing/PaymentResult";

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
  if (role === "renter") return <RenterDashboard />;
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
  const { user } = useAuth();
  // Super admins (and platform admins, for admin-scoped pages) keep access
  // to their tooling even while impersonating another role from the top bar.
  const accountOverride =
    (user?.role === "super_admin" && (allow.includes("super_admin") || allow.includes("admin"))) ||
    (user?.role === "admin" && allow.includes("admin"));
  if (!allow.includes(role) && !accountOverride) {
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
const renterOnly = (c: ComponentType) => () => <RoleGuard allow={["renter"]} component={c} />;
const centerOnly = (c: ComponentType) => () => <RoleGuard allow={["center"]} component={c} />;
const vendorOnly = (c: ComponentType) => () => <RoleGuard allow={["vendor"]} component={c} />;
const buyersOnly = (c: ComponentType) => () => <RoleGuard allow={["owner", "center", "fleet"]} component={c} />;
// Orders list: owner/center get their persona-scoped orders, admins see all.
// Fleet/vendor/delivery each have a role-specific queue (`/fleet/orders`,
// `/vendor/orders`, `/delivery/orders`) so we redirect them there instead
// of showing the shared owner/center list. Renters have no order surface
// at all and go home.
function OrdersListRoute() {
  const { role } = useRole();
  if (role === "fleet") return <Redirect to="/fleet/orders" />;
  if (role === "vendor") return <Redirect to="/vendor/orders" />;
  if (role === "delivery") return <Redirect to="/delivery/orders" />;
  if (role === "renter") return <Redirect to="/" />;
  return <Orders />;
}

// Order detail: server-side scoping decides what each role is allowed to see
// or do on a specific order (vendors fulfil, delivery agents update status,
// owners/centers act as buyers, admins observe). Renters have no business
// on this surface — they'd otherwise inherit the demo buyer identity if
// they navigated by URL — so they get bounced home.
function OrderDetailRoute() {
  const { role } = useRole();
  if (role === "renter") return <Redirect to="/" />;
  return <OrderDetail />;
}
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
        <Route path="/center/shop" component={centerOnly(CenterShop)} />

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
        <Route path="/fleet/orders" component={fleetOnly(FleetOrdersPage)} />
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
        <Route path="/admin/owners" component={adminOnly(AdminOwners)} />
        <Route path="/admin/safety" component={adminOnly(AdminSafety)} />
        <Route path="/admin/reminder-runs" component={adminOnly(AdminReminderRuns)} />

        {/* Super Admin Routes */}
        <Route path="/super-admin/landing" component={superAdminOnly(SuperAdminLandingEditor)} />
        <Route path="/super-admin/approvals" component={superAdminOnly(SuperAdminApprovals)} />
        <Route path="/super-admin/organizations" component={superAdminOnly(SuperAdminOrganizations)} />
        <Route path="/super-admin/onboard" component={superAdminOnly(SuperAdminOnboard)} />
        <Route path="/super-admin/commissions" component={superAdminOnly(SuperAdminCommissions)} />
        <Route path="/super-admin/payouts" component={superAdminOnly(SuperAdminPayouts)} />
        <Route path="/super-admin/payments" component={superAdminOnly(SuperAdminPayments)} />
        <Route path="/super-admin/finance" component={superAdminOnly(SuperAdminFinance)} />
        <Route path="/settings/payout" component={PayoutAccountPage} />

        {/* Rentals Routes (owners + admins can browse; bookings open to any role using owner shell) */}
        <Route path="/rentals" component={RentalsBrowse} />
        <Route path="/rentals/list-yours" component={ownerOnly(ListYourCar)} />
        <Route path="/rentals/my-listings" component={ownerOnly(MyListings)} />
        {/*
          /rentals/my-bookings and /rentals/profile are renter-only:
          a vehicle owner who also wants to rent must switch role to
          "renter" via the role tabs. This keeps the renter experience
          first-class and avoids accidentally serving owner accounts
          renter-specific UI they never asked for.
        */}
        <Route path="/rentals/my-bookings" component={renterOnly(MyRentals)} />
        <Route path="/rentals/profile" component={renterOnly(RenterProfilePage)} />
        <Route path="/rentals/drivers" component={ownerOnly(DriversPage)} />
        <Route path="/rentals/listing-requests" component={ownerOnly(ListingRequests)} />
        <Route path="/rentals/:id" component={RentalDetail} />

        {/* Marketplace (shared) */}
        <Route path="/marketplace" component={buyersOnly(Marketplace)} />
        <Route path="/marketplace/:id" component={PartDetail} />
        <Route path="/cart" component={buyersOnly(Cart)} />
        <Route path="/checkout" component={buyersOnly(Checkout)} />
        <Route path="/orders" component={OrdersListRoute} />
        <Route path="/orders/:id" component={OrderDetailRoute} />

        {/* Shared Routes */}
        <Route path="/bookings" component={Bookings} />
        <Route path="/bookings/:id" component={BookingDetail} />
        <Route path="/invoices/:id" component={InvoiceDetail} />
        <Route path="/billing/subscribe" component={Subscribe} />
        <Route path="/billing/result" component={PaymentResult} />
        <Route path="/profile" component={ProfilePage} />
        <Route path="/center/staff" component={centerOnly(CenterStaffPage)} />

            <Route component={NotFound} />
          </Switch>
        </AppShell>
  );
}

function AuthedShell() {
  const { user } = useAuth();
  // Admins/super-admins and grandfathered users (kycStatus === "verified")
  // see the full app. Pending/rejected applicants can't sign in at all, so by
  // the time we get here we only need to gate the post-approval KYC step.
  const needsKyc =
    !!user &&
    user.role !== "admin" &&
    user.role !== "super_admin" &&
    user.kycStatus !== "verified";
  return (
    <Switch>
      <Route path="/onboarding/kyc" component={OnboardingKyc} />
      <Route path="/onboarding/rejected">
        <OnboardingRejected />
      </Route>
      {needsKyc ? (
        <Route>
          <Redirect to="/onboarding/kyc" />
        </Route>
      ) : (
        <Route component={AppRouter} />
      )}
    </Switch>
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
      <Route path="/signup" component={SignupPage} />
      <Route path="/rentals/signup" component={RentalsSignup} />
      <Route path="/register-fleet" component={RegisterFleet} />

      {loading ? (
        <Route>
          <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
            Loading AutoCare...
          </div>
        </Route>
      ) : user ? (
        <Route component={AuthedShell} />
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
