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

const router: IRouter = Router();

router.use(healthRouter);
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

export default router;
