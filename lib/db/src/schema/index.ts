import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const branches = pgTable(
  "branches",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("branches_name_lower_uq").on(sql`lower(${table.name})`)],
);

export const appUsers = pgTable(
  "app_users",
  {
    id: text("id").primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    firstName: varchar("first_name", { length: 120 }),
    lastName: varchar("last_name", { length: 120 }),
    role: varchar("role", { length: 40 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("app_users_email_lower_uq").on(sql`lower(${table.email})`)],
);

export const userBranches = pgTable(
  "user_branches",
  {
    userId: text("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    branchId: integer("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.branchId] })],
);

export const userInvitations = pgTable(
  "user_invitations",
  {
    id: serial("id").primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    role: varchar("role", { length: 40 }).notNull(),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("user_invitations_email_lower_uq").on(sql`lower(${table.email})`),
  ],
);

export const invitationBranches = pgTable(
  "invitation_branches",
  {
    invitationId: integer("invitation_id")
      .notNull()
      .references(() => userInvitations.id, { onDelete: "cascade" }),
    branchId: integer("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.invitationId, table.branchId] })],
);

export const customers = pgTable(
  "customers",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 180 }).notNull(),
    phone: varchar("phone", { length: 80 }),
    normalizedPhone: varchar("normalized_phone", { length: 80 }),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("customers_name_idx").on(table.name),
    index("customers_phone_idx").on(table.normalizedPhone),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    orderNumber: varchar("order_number", { length: 32 }).notNull(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    branchId: integer("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    source: varchar("source", { length: 40 }).notNull(),
    sourceDetails: varchar("source_details", { length: 300 }),
    responsibleUserId: text("responsible_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    requestedDeliveryDate: date("requested_delivery_date", { mode: "string" }),
    statusOverride: varchar("status_override", { length: 30 }).notNull().default("none"),
    statusReason: varchar("status_reason", { length: 1000 }),
    notes: varchar("notes", { length: 4000 }),
    createdBy: text("created_by")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("orders_order_number_uq").on(table.orderNumber),
    index("orders_branch_created_idx").on(table.branchId, table.createdAt),
    index("orders_customer_idx").on(table.customerId),
    index("orders_responsible_user_idx").on(table.responsibleUserId),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productName: varchar("product_name", { length: 180 }).notNull(),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    unit: varchar("unit", { length: 40 }),
    specifications: varchar("specifications", { length: 4000 }),
    dimensions: varchar("dimensions", { length: 300 }),
    material: varchar("material", { length: 300 }),
    designRequired: boolean("design_required").notNull().default(false),
    designStatus: varchar("design_status", { length: 40 }).notNull().default("not_required"),
    designerUserId: text("designer_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    productionStatus: varchar("production_status", { length: 40 }).notNull().default("not_started"),
    status: varchar("status", { length: 40 }).notNull().default("new"),
    notes: varchar("notes", { length: 2000 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("order_items_order_id_idx").on(table.orderId)],
);

export const incomingReferences = pgTable(
  "incoming_references",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    source: varchar("source", { length: 40 }).notNull(),
    referenceDetails: varchar("reference_details", { length: 1000 }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [index("incoming_references_order_id_idx").on(table.orderId)],
);

export const orderAttachments = pgTable(
  "order_attachments",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    itemId: integer("item_id").references(() => orderItems.id, { onDelete: "set null" }),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    objectPath: text("object_path").notNull(),
    contentType: varchar("content_type", { length: 150 }).notNull(),
    fileSize: integer("file_size").notNull(),
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("order_attachments_object_path_uq").on(table.objectPath),
    index("order_attachments_order_id_idx").on(table.orderId),
  ],
);

export const orderActivity = pgTable(
  "order_activity",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    action: varchar("action", { length: 80 }).notNull(),
    summary: varchar("summary", { length: 1000 }).notNull(),
    occurredAt: createdAt(),
  },
  (table) => [index("order_activity_order_time_idx").on(table.orderId, table.occurredAt)],
);