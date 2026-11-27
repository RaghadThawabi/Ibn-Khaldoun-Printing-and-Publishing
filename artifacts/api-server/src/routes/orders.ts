import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  CreateOrderBody,
  CreateOrderResponse,
  FindPossibleDuplicateOrdersQueryParams,
  FindPossibleDuplicateOrdersResponse,
  GetOrderParams,
  GetOrderResponse,
  LinkIncomingReferenceBody,
  LinkIncomingReferenceParams,
  LinkIncomingReferenceResponse,
  ListOrderActivityParams,
  ListOrderActivityResponse,
  ListOrdersQueryParams,
  ListOrdersResponse,
  UpdateOrderBody,
  UpdateOrderParams,
  UpdateOrderResponse,
} from "@workspace/api-zod";
import {
  appUsers,
  customers,
  db,
  incomingReferences,
  orderActivity,
  orderItems,
  orders,
  userBranches,
} from "@workspace/db";
import {
  branchExists,
  canAccessBranch,
  requireAppUser,
  requireRoles,
} from "../lib/auth";
import {
  fetchOrderDetail,
  fetchOrderSummaries,
  normalizePhone,
  orderForUser,
  toIso,
} from "../lib/orderData";

const router: IRouter = Router();

const dateOnly = (value: Date | null | undefined): string | null | undefined =>
  value == null ? value : value.toISOString().slice(0, 10);

async function validAssignee(userId: string, branchId: number): Promise<boolean> {
  const [assignee] = await db
    .select({ id: appUsers.id, role: appUsers.role, status: appUsers.status })
    .from(appUsers)
    .where(eq(appUsers.id, userId))
    .limit(1);
  if (!assignee || assignee.status !== "active") return false;
  if (assignee.role === "admin") return true;
  const [branch] = await db
    .select({ branchId: userBranches.branchId })
    .from(userBranches)
    .where(and(eq(userBranches.userId, userId), eq(userBranches.branchId, branchId)))
    .limit(1);
  return Boolean(branch);
}

router.get(
  "/orders/possible-duplicates",
  requireAppUser,
  async (req, res): Promise<void> => {
    const query = FindPossibleDuplicateOrdersQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: query.error.message });
      return;
    }
    const phone = normalizePhone(query.data.phone);
    if (!phone || phone.length < 3) {
      res.json(FindPossibleDuplicateOrdersResponse.parse([]));
      return;
    }
    const conditions = [
      eq(customers.normalizedPhone, phone),
      ne(orders.statusOverride, "cancelled"),
    ];
    if (req.appUser!.role !== "admin") {
      if (!req.appUser!.branchIds.length) {
        res.json(FindPossibleDuplicateOrdersResponse.parse([]));
        return;
      }
      conditions.push(inArray(orders.branchId, req.appUser!.branchIds));
    }
    const matches = await db
      .select({ id: orders.id })
      .from(orders)
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .where(and(...conditions))
      .orderBy(desc(orders.createdAt))
      .limit(25);
    const details = await Promise.all(
      matches.map(({ id }) => fetchOrderDetail(id)),
    );
    const candidates = details.flatMap((order) => {
      if (!order || ["completed", "cancelled"].includes(order.status)) return [];
      return [{
        order: {
          id: order.id,
          orderNumber: order.orderNumber,
          customer: order.customer,
          branch: order.branch,
          source: order.source,
          status: order.status,
          responsibleUser: order.responsibleUser,
          requestedDeliveryDate: order.requestedDeliveryDate,
          itemCount: order.itemCount,
          createdAt: order.createdAt,
        },
        matchReason: "مطابقة رقم الهاتف",
      }];
    });
    res.json(FindPossibleDuplicateOrdersResponse.parse(candidates));
  },
);

router.get("/orders", requireAppUser, async (req, res): Promise<void> => {
  const query = ListOrdersQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const records = await fetchOrderSummaries({
    user: req.appUser!,
    search: query.data.search,
    branchId: query.data.branchId,
    status: query.data.status,
    source: query.data.source,
    assignedUserId: query.data.assignedUserId,
    limit: query.data.limit,
  });
  res.json(ListOrdersResponse.parse(records));
});

router.post(
  "/orders",
  requireAppUser,
  requireRoles("admin", "manager", "order_reception"),
  async (req, res): Promise<void> => {
    const parsed = CreateOrderBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const input = parsed.data;
    const user = req.appUser!;
    if (!(await branchExists(input.branchId))) {
      res.status(400).json({ error: "Choose an active branch." });
      return;
    }
    if (!canAccessBranch(user, input.branchId)) {
      res.status(403).json({ error: "You do not have access to that branch." });
      return;
    }
    const [customer] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, input.customerId))
      .limit(1);
    if (!customer) {
      res.status(400).json({ error: "Choose a registered customer." });
      return;
    }
    if (
      input.responsibleUserId &&
      !(await validAssignee(input.responsibleUserId, input.branchId))
    ) {
      res.status(400).json({ error: "Choose an active employee assigned to this branch." });
      return;
    }

    const orderId = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(orders)
        .values({
          orderNumber: `T${randomUUID().replaceAll("-", "").slice(0, 12)}`,
          customerId: input.customerId,
          branchId: input.branchId,
          source: input.source,
          sourceDetails: input.sourceDetails?.trim() || null,
          responsibleUserId: input.responsibleUserId ?? null,
          requestedDeliveryDate: dateOnly(input.requestedDeliveryDate) ?? null,
          notes: input.notes?.trim() || null,
          createdBy: user.id,
        })
        .returning({ id: orders.id });
      const orderNumber = `IK-${new Date().getFullYear()}-${String(created.id).padStart(6, "0")}`;
      await tx
        .update(orders)
        .set({ orderNumber, updatedAt: new Date() })
        .where(eq(orders.id, created.id));
      await tx.insert(orderItems).values(
        input.items.map((item) => ({
          orderId: created.id,
          productName: item.productName.trim(),
          quantity: String(item.quantity),
          unit: item.unit?.trim() || null,
          specifications: item.specifications?.trim() || null,
          dimensions: item.dimensions?.trim() || null,
          material: item.material?.trim() || null,
          designRequired: item.designRequired ?? false,
          designStatus: item.designRequired ? "waiting" : "not_required",
        })),
      );
      await tx.insert(orderActivity).values({
        orderId: created.id,
        actorUserId: user.id,
        action: "order_created",
        summary: `تم تسجيل الطلب ${orderNumber}`,
      });
      return created.id;
    });
    const detail = await fetchOrderDetail(orderId);
    if (!detail) {
      res.status(500).json({ error: "The order was saved but could not be loaded." });
      return;
    }
    res.status(201).json(CreateOrderResponse.parse(detail));
  },
);

router.get(
  "/orders/:orderId",
  requireAppUser,
  async (req, res): Promise<void> => {
    const params = GetOrderParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const order = await orderForUser(params.data.orderId, req.appUser!);
    if (!order) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    const detail = await fetchOrderDetail(order.id);
    if (!detail) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    res.json(GetOrderResponse.parse(detail));
  },
);

router.patch(
  "/orders/:orderId",
  requireAppUser,
  requireRoles("admin", "manager", "order_reception"),
  async (req, res): Promise<void> => {
    const params = UpdateOrderParams.safeParse(req.params);
    const parsed = UpdateOrderBody.safeParse(req.body);
    if (!params.success || !parsed.success || !Object.keys(parsed.data ?? {}).length) {
      res.status(400).json({ error: "Enter a valid order update." });
      return;
    }
    const user = req.appUser!;
    const current = await orderForUser(params.data.orderId, user);
    if (!current) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    const nextBranchId = parsed.data.branchId ?? current.branchId;
    if (parsed.data.branchId !== undefined) {
      if (user.role === "order_reception") {
        res.status(403).json({ error: "Only managers can move an order to another branch." });
        return;
      }
      if (!(await branchExists(nextBranchId))) {
        res.status(400).json({ error: "Choose an active branch." });
        return;
      }
      if (!canAccessBranch(user, nextBranchId)) {
        res.status(403).json({ error: "You do not have access to that branch." });
        return;
      }
    }
    if (
      parsed.data.responsibleUserId &&
      !(await validAssignee(parsed.data.responsibleUserId, nextBranchId))
    ) {
      res.status(400).json({ error: "Choose an active employee assigned to this branch." });
      return;
    }
    if (
      parsed.data.branchId !== undefined &&
      parsed.data.responsibleUserId === undefined &&
      current.responsibleUserId &&
      !(await validAssignee(current.responsibleUserId, nextBranchId))
    ) {
      res.status(400).json({ error: "Assign an employee in the new branch or clear the current assignment." });
      return;
    }

    const changes = parsed.data;
    const update: Partial<typeof orders.$inferInsert> = { updatedAt: new Date() };
    if (changes.branchId !== undefined) update.branchId = changes.branchId;
    if (changes.responsibleUserId !== undefined) update.responsibleUserId = changes.responsibleUserId;
    if (changes.requestedDeliveryDate !== undefined) {
      update.requestedDeliveryDate = dateOnly(changes.requestedDeliveryDate) ?? null;
    }
    if (changes.notes !== undefined) update.notes = changes.notes;
    if (changes.statusOverride !== undefined) {
      update.statusOverride = changes.statusOverride;
      update.statusReason =
        changes.statusOverride === "none" ? null : changes.statusReason?.trim() || null;
    } else if (changes.statusReason !== undefined) {
      update.statusReason = changes.statusReason?.trim() || null;
    }
    const summary = changes.responsibleUserId !== undefined
      ? changes.responsibleUserId
        ? "تم تحديث المسؤول عن الطلب"
        : "تم إلغاء تعيين المسؤول عن الطلب"
      : changes.statusOverride !== undefined
        ? "تم تحديث الحالة الاستثنائية للطلب"
        : changes.branchId !== undefined
          ? "تم نقل الطلب إلى فرع آخر"
          : changes.requestedDeliveryDate !== undefined
            ? "تم تحديث موعد التسليم المطلوب"
            : "تم تحديث تفاصيل الطلب";

    await db.transaction(async (tx) => {
      await tx.update(orders).set(update).where(eq(orders.id, current.id));
      await tx.insert(orderActivity).values({
        orderId: current.id,
        actorUserId: user.id,
        action: "order_updated",
        summary,
      });
    });
    const detail = await fetchOrderDetail(current.id);
    if (!detail) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    res.json(UpdateOrderResponse.parse(detail));
  },
);

router.post(
  "/orders/:orderId/references",
  requireAppUser,
  requireRoles("admin", "manager", "order_reception"),
  async (req, res): Promise<void> => {
    const params = LinkIncomingReferenceParams.safeParse(req.params);
    const parsed = LinkIncomingReferenceBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: "Enter a valid incoming reference." });
      return;
    }
    const order = await orderForUser(params.data.orderId, req.appUser!);
    if (!order) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    const receivedAt = parsed.data.receivedAt
      ? new Date(parsed.data.receivedAt)
      : new Date();
    const [reference] = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(incomingReferences)
        .values({
          orderId: order.id,
          source: parsed.data.source,
          referenceDetails: parsed.data.referenceDetails?.trim() || null,
          receivedAt,
        })
        .returning();
      await tx.insert(orderActivity).values({
        orderId: order.id,
        actorUserId: req.appUser!.id,
        action: "reference_linked",
        summary: "تم ربط رسالة واردة بالطلب",
      });
      return [created];
    });
    res.status(201).json(
      LinkIncomingReferenceResponse.parse({
        ...reference,
        receivedAt: toIso(reference.receivedAt),
        createdAt: toIso(reference.createdAt),
      }),
    );
  },
);

router.get(
  "/orders/:orderId/activity",
  requireAppUser,
  async (req, res): Promise<void> => {
    const params = ListOrderActivityParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const order = await orderForUser(params.data.orderId, req.appUser!);
    if (!order) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    const rows = await db
      .select()
      .from(orderActivity)
      .where(eq(orderActivity.orderId, order.id))
      .orderBy(orderActivity.occurredAt);
    res.json(
      ListOrderActivityResponse.parse(
        rows.map((entry) => ({
          id: entry.id,
          actorUserId: entry.actorUserId,
          action: entry.action,
          summary: entry.summary,
          occurredAt: toIso(entry.occurredAt),
        })),
      ),
    );
  },
);

export default router;
