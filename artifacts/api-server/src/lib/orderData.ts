import { and, desc, eq, inArray, ilike, or } from "drizzle-orm";
import {
  appUsers,
  branches,
  customers,
  db,
  incomingReferences,
  orderActivity,
  orderAttachments,
  orderItems,
  orders,
  userBranches,
} from "@workspace/db";
import type { ActiveAppUser } from "./auth";

export const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : value;

export function serializeBranch(branch: typeof branches.$inferSelect) {
  return {
    id: branch.id,
    name: branch.name,
    isActive: branch.isActive,
    createdAt: toIso(branch.createdAt),
    updatedAt: toIso(branch.updatedAt),
  };
}

export function serializeCustomer(customer: typeof customers.$inferSelect) {
  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    notes: customer.notes,
    createdAt: toIso(customer.createdAt),
    updatedAt: toIso(customer.updatedAt),
  };
}

export async function getAppUsersByIds(
  ids: Array<string | null | undefined>,
): Promise<Map<string, ReturnType<typeof serializeAppUser>>> {
  const cleanIds = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!cleanIds.length) return new Map();
  const profiles = await db.select().from(appUsers).where(inArray(appUsers.id, cleanIds));
  const memberships = await db
    .select({ userId: userBranches.userId, branchId: userBranches.branchId })
    .from(userBranches)
    .where(inArray(userBranches.userId, cleanIds));
  const branchesByUser = new Map<string, number[]>();
  for (const membership of memberships) {
    const list = branchesByUser.get(membership.userId) ?? [];
    list.push(membership.branchId);
    branchesByUser.set(membership.userId, list);
  }
  return new Map(
    profiles.map((profile) => [
      profile.id,
      serializeAppUser(profile, branchesByUser.get(profile.id) ?? []),
    ]),
  );
}

export function serializeAppUser(
  user: typeof appUsers.$inferSelect,
  branchIds: number[],
) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    status: user.status,
    branchIds,
    createdAt: toIso(user.createdAt),
  };
}

export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length ? digits : null;
}

export function derivedOrderStatus(
  statusOverride: string,
  items: Array<{ status: string }>,
): string {
  if (statusOverride === "on_hold" || statusOverride === "cancelled") return statusOverride;
  if (!items.length) return "new";
  const delivered = items.filter((item) => item.status === "delivered").length;
  const ready = items.filter((item) => item.status === "ready" || item.status === "delivered").length;
  if (delivered === items.length) return "completed";
  if (delivered > 0) return "partially_delivered";
  if (ready === items.length) return "ready";
  if (ready > 0) return "partially_ready";
  if (items.some((item) => item.status === "in_progress")) return "in_progress";
  return "new";
}

export function serializeOrderItem(item: typeof orderItems.$inferSelect) {
  return {
    ...item,
    quantity: Number(item.quantity),
    createdAt: toIso(item.createdAt),
    updatedAt: toIso(item.updatedAt),
  };
}

export async function fetchOrderDetail(orderId: number) {
  const [record] = await db
    .select({ order: orders, customer: customers, branch: branches })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .innerJoin(branches, eq(orders.branchId, branches.id))
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!record) return null;

  const [items, attachments, references, activity] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(orderItems.id),
    db.select().from(orderAttachments).where(eq(orderAttachments.orderId, orderId)).orderBy(orderAttachments.createdAt),
    db.select().from(incomingReferences).where(eq(incomingReferences.orderId, orderId)).orderBy(incomingReferences.receivedAt),
    db.select().from(orderActivity).where(eq(orderActivity.orderId, orderId)).orderBy(orderActivity.occurredAt),
  ]);
  const users = await getAppUsersByIds([
    record.order.responsibleUserId,
    ...items.map((item) => item.designerUserId),
    ...attachments.map((attachment) => attachment.uploadedBy),
    ...activity.map((entry) => entry.actorUserId),
  ]);
  const serializedItems = items.map(serializeOrderItem);

  return {
    id: record.order.id,
    orderNumber: record.order.orderNumber,
    customer: serializeCustomer(record.customer),
    branch: serializeBranch(record.branch),
    source: record.order.source,
    sourceDetails: record.order.sourceDetails,
    status: derivedOrderStatus(record.order.statusOverride, serializedItems),
    responsibleUser: record.order.responsibleUserId
      ? users.get(record.order.responsibleUserId) ?? null
      : null,
    requestedDeliveryDate: record.order.requestedDeliveryDate,
    itemCount: serializedItems.length,
    createdAt: toIso(record.order.createdAt),
    notes: record.order.notes,
    items: serializedItems,
    attachments: attachments.map((attachment) => ({
      ...attachment,
      uploadedBy: attachment.uploadedBy,
      createdAt: toIso(attachment.createdAt),
    })),
    references: references.map((reference) => ({
      ...reference,
      receivedAt: toIso(reference.receivedAt),
      createdAt: toIso(reference.createdAt),
    })),
    activity: activity.map((entry) => ({
      id: entry.id,
      actorUserId: entry.actorUserId,
      action: entry.action,
      summary: entry.summary,
      occurredAt: toIso(entry.occurredAt),
    })),
    updatedAt: toIso(record.order.updatedAt),
  };
}

export async function fetchOrderSummaries({
  user,
  search,
  branchId,
  status,
  source,
  assignedUserId,
  limit,
}: {
  user: ActiveAppUser;
  search?: string;
  branchId?: number;
  status?: string;
  source?: string;
  assignedUserId?: string;
  limit: number;
}) {
  const conditions = [];
  if (user.role !== "admin") {
    if (!user.branchIds.length) return [];
    conditions.push(inArray(orders.branchId, user.branchIds));
  }
  if (branchId !== undefined) {
    if (user.role !== "admin" && !user.branchIds.includes(branchId)) return [];
    conditions.push(eq(orders.branchId, branchId));
  }
  if (source) conditions.push(eq(orders.source, source));
  if (assignedUserId) conditions.push(eq(orders.responsibleUserId, assignedUserId));
  if (search?.trim()) {
    const term = `%${search.trim()}%`;
    conditions.push(or(ilike(orders.orderNumber, term), ilike(customers.name, term), ilike(customers.phone, term))!);
  }

  const baseQuery = db
    .select({ order: orders, customer: customers, branch: branches })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .innerJoin(branches, eq(orders.branchId, branches.id))
    .orderBy(desc(orders.createdAt))
    .limit(Math.min(Math.max(limit * 10, 100), 1000));
  const records = await (conditions.length ? baseQuery.where(and(...conditions)) : baseQuery);
  if (!records.length) return [];

  const orderIds = records.map(({ order }) => order.id);
  const items = await db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds));
  const itemsByOrder = new Map<number, typeof items>();
  for (const item of items) {
    const list = itemsByOrder.get(item.orderId) ?? [];
    list.push(item);
    itemsByOrder.set(item.orderId, list);
  }
  const users = await getAppUsersByIds(records.map(({ order }) => order.responsibleUserId));
  const mapped = records.map(({ order, customer, branch }) => {
    const orderItems = itemsByOrder.get(order.id) ?? [];
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      customer: serializeCustomer(customer),
      branch: serializeBranch(branch),
      source: order.source,
      status: derivedOrderStatus(order.statusOverride, orderItems),
      responsibleUser: order.responsibleUserId
        ? users.get(order.responsibleUserId) ?? null
        : null,
      requestedDeliveryDate: order.requestedDeliveryDate,
      itemCount: orderItems.length,
      createdAt: toIso(order.createdAt),
    };
  });
  return mapped
    .filter((item) => !status || item.status === status)
    .slice(0, limit);
}

export async function orderForUser(orderId: number, user: ActiveAppUser) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return null;
  if (user.role !== "admin" && !user.branchIds.includes(order.branchId)) return null;
  return order;
}

export async function recordOrderActivity(
  orderId: number,
  actorUserId: string,
  action: string,
  summary: string,
): Promise<void> {
  await db.insert(orderActivity).values({ orderId, actorUserId, action, summary });
}

export async function findOrderIdsForBranches(user: ActiveAppUser) {
  const query = db
    .select({
      id: orders.id,
      customerId: orders.customerId,
      statusOverride: orders.statusOverride,
      responsibleUserId: orders.responsibleUserId,
    })
    .from(orders);
  if (user.role === "admin") return query;
  if (!user.branchIds.length) return [];
  return query.where(inArray(orders.branchId, user.branchIds));
}
