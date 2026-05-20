import { Router, type IRouter } from "express";
import healthRouter from "./health";
import vehiclesRouter from "./vehicles";
import serviceCentersRouter from "./serviceCenters";
import bookingsRouter from "./bookings";
import invoicesRouter from "./invoices";
import dashboardRouter from "./dashboard";
import vendorsRouter from "./vendors";
import partsRouter from "./parts";
import ordersRouter from "./orders";
import deliveryAgentsRouter from "./deliveryAgents";
import mechanicsRouter from "./mechanics";
import adminRouter from "./admin";
import platformStaffRouter from "./platformStaff";
import vendorStaffRouter from "./vendorStaff";
import centerStaffRouter from "./centerStaff";
import subscriptionsRouter from "./subscriptions";
import revenueRouter from "./revenue";
import rentalsRouter from "./rentals";
import driversRouter from "./drivers";
import storageRouter from "./storage";
import retainersRouter from "./retainers";
import notificationsRouter from "./notifications";
import pushRouter from "./push";
import authRouter from "./auth";
import landingContentRouter from "./landingContent";
import organizationsRouter from "./organizations";
import onboardingRouter, { requireKycVerified } from "./onboarding";
import addressesRouter from "./addresses";
import publicCatalogRouter from "./publicCatalog";

const router: IRouter = Router();

// Public + onboarding-friendly routes mount FIRST so unverified users can
// still sign in, hit storage uploads, and finish KYC.
router.use(healthRouter);
router.use(authRouter);
router.use(storageRouter);
router.use(landingContentRouter);
router.use(onboardingRouter);
// Public catalog facets + VAPID key. Must be mounted before any router
// that calls `router.use(requireAuth)` internally, because sub-router
// middleware fires for every request entering the sub-router (not just
// for routes that match inside it).
router.use(publicCatalogRouter);

// Global KYC gate: signed-in users whose KYC isn't verified get 403 on
// anything below. Anonymous traffic and admins pass through.
router.use(requireKycVerified);

router.use(vehiclesRouter);
router.use(serviceCentersRouter);
router.use(bookingsRouter);
router.use(invoicesRouter);
router.use(dashboardRouter);
router.use(vendorsRouter);
router.use(partsRouter);
router.use(ordersRouter);
router.use(deliveryAgentsRouter);
router.use(mechanicsRouter);
router.use(adminRouter);
router.use(platformStaffRouter);
router.use(vendorStaffRouter);
router.use(centerStaffRouter);
router.use(subscriptionsRouter);
router.use(revenueRouter);
router.use(rentalsRouter);
router.use(driversRouter);
router.use(retainersRouter);
router.use(notificationsRouter);
router.use(pushRouter);
router.use(organizationsRouter);
router.use(addressesRouter);

export default router;
