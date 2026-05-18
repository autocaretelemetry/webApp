import { Router, type IRouter } from "express";
import healthRouter from "./health";
import vehiclesRouter from "./vehicles";
import serviceCentersRouter from "./serviceCenters";
import bookingsRouter from "./bookings";
import invoicesRouter from "./invoices";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(vehiclesRouter);
router.use(serviceCentersRouter);
router.use(bookingsRouter);
router.use(invoicesRouter);
router.use(dashboardRouter);

export default router;
