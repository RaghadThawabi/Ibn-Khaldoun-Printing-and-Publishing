import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateBranchBody,
  CreateBranchResponse,
  ListBranchesQueryParams,
  ListBranchesResponse,
  UpdateBranchBody,
  UpdateBranchParams,
  UpdateBranchResponse,
} from "@workspace/api-zod";
import { inArray } from "drizzle-orm";
import { branches, db } from "@workspace/db";
import { requireAppUser, requireRoles } from "../lib/auth";
import { serializeBranch } from "../lib/orderData";

const router: IRouter = Router();

router.get("/branches", requireAppUser, async (req, res): Promise<void> => {
  const query = ListBranchesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const user = req.appUser!;
  const conditions = [];
  if (!query.data.includeInactive) conditions.push(eq(branches.isActive, true));
  if (user.role !== "admin") {
    if (!user.branchIds.length) {
      res.json(ListBranchesResponse.parse([]));
      return;
    }
    conditions.push(inArray(branches.id, user.branchIds));
  }
  const records = await db
    .select()
    .from(branches)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(branches.name);
  res.json(ListBranchesResponse.parse(records.map(serializeBranch)));
});

router.post(
  "/branches",
  requireAppUser,
  requireRoles("admin"),
  async (req, res): Promise<void> => {
    const parsed = CreateBranchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const [branch] = await db
        .insert(branches)
        .values({ name: parsed.data.name.trim() })
        .returning();
      res.status(201).json(CreateBranchResponse.parse(serializeBranch(branch)));
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        res.status(409).json({ error: "A branch with that name already exists." });
        return;
      }
      throw error;
    }
  },
);

router.patch(
  "/branches/:branchId",
  requireAppUser,
  requireRoles("admin"),
  async (req, res): Promise<void> => {
    const params = UpdateBranchParams.safeParse(req.params);
    const parsed = UpdateBranchBody.safeParse(req.body);
    if (!params.success || !parsed.success || !Object.keys(parsed.data ?? {}).length) {
      res.status(400).json({ error: "Enter a valid branch update." });
      return;
    }
    try {
      const [branch] = await db
        .update(branches)
        .set({ ...parsed.data, name: parsed.data.name?.trim(), updatedAt: new Date() })
        .where(eq(branches.id, params.data.branchId))
        .returning();
      if (!branch) {
        res.status(404).json({ error: "Branch not found." });
        return;
      }
      res.json(UpdateBranchResponse.parse(serializeBranch(branch)));
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        res.status(409).json({ error: "A branch with that name already exists." });
        return;
      }
      throw error;
    }
  },
);

export default router;
