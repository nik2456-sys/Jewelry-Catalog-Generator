import { Router, type IRouter } from "express";
import healthRouter from "./health";
import catalogRouter from "./catalog";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/catalog", catalogRouter);

export default router;
