import { and, count, countDistinct, eq, inArray } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  appUsers,
  branches,
  customers,
  db,
  orderItems,
  orders,
} from "@workspace/db";
import {
  GetDashboardSummaryResponse,
  GetMyAppProfileResponse,
} from "@workspace/api-zod";
import { loadAppProfile, requireAppUser } from "../lib/auth";
import {
  derivedOrderStatus,
  findOrderIdsForBranches,
} from "../lib/orderData";

const router: IRouter = Router();

router.get("/me", async (req, res): Promise<void> => {
  try {
    res.json(GetMyAppProfileResponse.parse(await loadAppProfile(req)));
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") {
      res.status(401).json({ error: "Sign-in required.", code: "unauthenticated" });
      return;
    }
    req.log.error({ err: error }, "Could not load the current profile");
    res.status(503).json({ error: "App access could not be checked. Please try again." });
  }
});

router.get("/dashboard/summary", requireAppUser, async (req, res): Promise<void> => {
  const user = req.appUser!;
  const orderRows = await findOrderIdsForBranches(user);
  const ids = orderRows.map((row) => row.id);
  const itemRows = ids.length
    ? await db.select().from(orderItems).where(inArray(orderItems.orderId, ids))
    : [];
  const itemsByOrder = new Map<number, typeof itemRows>();
  for (const item of itemRows) {
    const list = itemsByOrder.get(item.orderId) ?? [];
    list.push(item);
    itemsByOrder.set(item.orderId, list);
  }
  const statuses = orderRows.map((order) => ({
    order,
    status: derivedOrderStatus(order.statusOverride, itemsByOrder.get(order.id) ?? []),
  }));

  let totalCustomers = 0;
  if (user.role === "admin") {
    const [result] = await db.select({ value: count() }).from(customers);
    totalCustomers = Number(result?.value ?? 0);
  } else if (user.branchIds.length) {
    const [result] = await db
      .select({ value: countDistinct(customers.id) })
      .from(customers)
      .innerJoin(orders, eq(orders.customerId, customers.id))
      .where(inArray(orders.branchId, user.branchIds));
    totalCustomers = Number(result?.value ?? 0);
  }

  const branchCondition =
    user.role === "admin"
      ? eq(branches.isActive, true)
      : user.branchIds.length
        ? and(eq(branches.isActive, true), inArray(branches.id, user.branchIds))
        : eq(branches.id, -1);
  const [branchCount] = await db
    .select({ value: count() })
    .from(branches)
    .where(branchCondition);

  res.json(
    GetDashboardSummaryResponse.parse({
      totalOrders: orderRows.length,
      activeOrders: statuses.filter(
        ({ status }) => !["completed", "cancelled", "on_hold"].includes(status),
      ).length,
      ordersAwaitingAssignment: orderRows.filter(
        (order) => !order.responsibleUserId,
      ).length,
      readyOrders: statuses.filter(({ status }) =>
        ["ready", "partially_ready"].includes(status),
      ).length,
      totalCustomers,
      totalBranches: Number(branchCount?.value ?? 0),
    }),
  );
});

export default router;
