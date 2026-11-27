import { Router, type IRouter } from "express";
import healthRouter from "./health";
import applicationRouter from "./application";
import branchesRouter from "./branches";
import customersRouter from "./customers";
import ordersRouter from "./orders";
import orderItemsRouter from "./order-items";
import storageRouter from "./storage";
import usersRouter from "./users";

const router: IRouter = Router();

router.use(healthRouter);
router.use(applicationRouter);
router.use(branchesRouter);
router.use(customersRouter);
router.use(usersRouter);
router.use(ordersRouter);
router.use(orderItemsRouter);
router.use(storageRouter);

export default router;
