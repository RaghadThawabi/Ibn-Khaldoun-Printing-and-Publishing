import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  UpdateOrderItemBody,
  UpdateOrderItemParams,
  UpdateOrderItemResponse,
} from "@workspace/api-zod";
import { appUsers, db, orderActivity, orderItems, orders, userBranches } from "@workspace/db";
import { requireAppUser } from "../lib/auth";
import { orderForUser, serializeOrderItem } from "../lib/orderData";

const router: IRouter = Router();

router.patch(
  "/order-items/:itemId",
  requireAppUser,
  async (req, res): Promise<void> => {
    const params = UpdateOrderItemParams.safeParse(req.params);
    const parsed = UpdateOrderItemBody.safeParse(req.body);
    if (!params.success || !parsed.success || !Object.keys(parsed.data ?? {}).length) {
      res.status(400).json({ error: "Enter a valid product update." });
      return;
    }
    const actor = req.appUser!;
    const [item] = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.id, params.data.itemId))
      .limit(1);
    if (!item) {
      res.status(404).json({ error: "Order item not found." });
      return;
    }
    const order = await orderForUser(item.orderId, actor);
    if (!order) {
      res.status(404).json({ error: "Order item not found." });
      return;
    }

    const updates = parsed.data;
    if (actor.role === "designer") {
      if (item.designerUserId && item.designerUserId !== actor.id) {
        res.status(403).json({ error: "This product is assigned to another designer." });
        return;
      }
      if (
        Object.keys(updates).some(
          (key) => !["designStatus", "designerUserId", "notes"].includes(key),
        )
      ) {
        res.status(403).json({ error: "Designers can update only design progress and notes." });
        return;
      }
      if (updates.designerUserId && updates.designerUserId !== actor.id) {
        res.status(403).json({ error: "A designer can only assign the product to themselves." });
        return;
      }
    } else if (actor.role === "production_employee") {
      if (
        Object.keys(updates).some(
          (key) => !["productionStatus", "status", "notes"].includes(key),
        )
      ) {
        res.status(403).json({ error: "Production staff can update only production progress and notes." });
        return;
      }
    } else if (
      !["admin", "manager", "order_reception"].includes(actor.role)
    ) {
      res.status(403).json({ error: "This action is not available for your role." });
      return;
    }

    if (updates.designerUserId) {
      const [designer] = await db
        .select({ id: appUsers.id, role: appUsers.role, status: appUsers.status })
        .from(appUsers)
        .where(eq(appUsers.id, updates.designerUserId))
        .limit(1);
      const memberships = await db
        .select({ branchId: userBranches.branchId })
        .from(userBranches)
        .where(eq(userBranches.userId, updates.designerUserId));
      if (
        !designer ||
        designer.role !== "designer" ||
        designer.status !== "active" ||
        !memberships.some((entry) => entry.branchId === order.branchId)
      ) {
        res.status(400).json({ error: "Choose an active designer assigned to this branch." });
        return;
      }
    }

    const update: Partial<typeof orderItems.$inferInsert> = {
      ...updates,
      quantity:
        updates.quantity === undefined ? undefined : String(updates.quantity),
      updatedAt: new Date(),
    };
    if (updates.designRequired === false && updates.designStatus === undefined) {
      update.designStatus = "not_required";
    } else if (
      updates.designRequired === true &&
      updates.designStatus === undefined &&
      item.designStatus === "not_required"
    ) {
      update.designStatus = "waiting";
    }
    if (actor.role === "designer" && !item.designerUserId) {
      update.designerUserId = actor.id;
    }

    await db.transaction(async (tx) => {
      await tx.update(orderItems).set(update).where(eq(orderItems.id, item.id));
      await tx.update(orders).set({ updatedAt: new Date() }).where(eq(orders.id, order.id));
      await tx.insert(orderActivity).values({
        orderId: order.id,
        actorUserId: actor.id,
        action: "item_updated",
        summary: `تم تحديث تقدم المنتج: ${item.productName}`,
      });
    });
    const [updated] = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.id, item.id))
      .limit(1);
    res.json(UpdateOrderItemResponse.parse(serializeOrderItem(updated)));
  },
);

export default router;
