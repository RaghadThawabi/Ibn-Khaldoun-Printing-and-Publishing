import { desc, eq, ilike, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateCustomerBody,
  CreateCustomerResponse,
  GetCustomerParams,
  GetCustomerResponse,
  ListCustomersQueryParams,
  ListCustomersResponse,
  UpdateCustomerBody,
  UpdateCustomerParams,
  UpdateCustomerResponse,
} from "@workspace/api-zod";
import { customers, db } from "@workspace/db";
import { requireAppUser, requireRoles } from "../lib/auth";
import { normalizePhone, serializeCustomer } from "../lib/orderData";

const router: IRouter = Router();

router.get("/customers", requireAppUser, async (req, res): Promise<void> => {
  const query = ListCustomersQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const term = query.data.search?.trim();
  const records = await db
    .select()
    .from(customers)
    .where(
      term
        ? or(ilike(customers.name, `%${term}%`), ilike(customers.phone, `%${term}%`))
        : undefined,
    )
    .orderBy(desc(customers.updatedAt))
    .limit(query.data.limit);
  res.json(ListCustomersResponse.parse(records.map(serializeCustomer)));
});

router.post(
  "/customers",
  requireAppUser,
  requireRoles("admin", "manager", "order_reception"),
  async (req, res): Promise<void> => {
    const parsed = CreateCustomerBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [customer] = await db
      .insert(customers)
      .values({
        name: parsed.data.name.trim(),
        phone: parsed.data.phone?.trim() || null,
        normalizedPhone: normalizePhone(parsed.data.phone),
        notes: parsed.data.notes?.trim() || null,
      })
      .returning();
    res.status(201).json(CreateCustomerResponse.parse(serializeCustomer(customer)));
  },
);

router.get("/customers/:customerId", requireAppUser, async (req, res): Promise<void> => {
  const params = GetCustomerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, params.data.customerId))
    .limit(1);
  if (!customer) {
    res.status(404).json({ error: "Customer not found." });
    return;
  }
  res.json(GetCustomerResponse.parse(serializeCustomer(customer)));
});

router.patch(
  "/customers/:customerId",
  requireAppUser,
  requireRoles("admin", "manager", "order_reception"),
  async (req, res): Promise<void> => {
    const params = UpdateCustomerParams.safeParse(req.params);
    const parsed = UpdateCustomerBody.safeParse(req.body);
    if (!params.success || !parsed.success || !Object.keys(parsed.data ?? {}).length) {
      res.status(400).json({ error: "Enter valid customer details." });
      return;
    }
    const changes = {
      ...parsed.data,
      name: parsed.data.name?.trim(),
      phone: parsed.data.phone?.trim() || (parsed.data.phone === null ? null : undefined),
      notes: parsed.data.notes?.trim() || (parsed.data.notes === null ? null : undefined),
      updatedAt: new Date(),
    };
    const [customer] = await db
      .update(customers)
      .set({
        ...changes,
        normalizedPhone:
          parsed.data.phone !== undefined
            ? normalizePhone(parsed.data.phone)
            : undefined,
      })
      .where(eq(customers.id, params.data.customerId))
      .returning();
    if (!customer) {
      res.status(404).json({ error: "Customer not found." });
      return;
    }
    res.json(UpdateCustomerResponse.parse(serializeCustomer(customer)));
  },
);

export default router;
