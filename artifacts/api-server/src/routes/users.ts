import { and, eq, inArray, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateUserInvitationBody,
  CreateUserInvitationResponse,
  ListAppUsersResponse,
  ListUserInvitationsResponse,
  RevokeUserInvitationParams,
  UpdateAppUserBody,
  UpdateAppUserParams,
  UpdateAppUserResponse,
} from "@workspace/api-zod";
import {
  appUsers,
  db,
  invitationBranches,
  userBranches,
  userInvitations,
} from "@workspace/db";
import {
  branchExists,
  requireAppUser,
  requireRoles,
} from "../lib/auth";
import { getAppUsersByIds, serializeAppUser, toIso } from "../lib/orderData";

const router: IRouter = Router();
const normalizeEmail = (email: string) => email.trim().toLowerCase();

async function visibleUserIds(managerBranchIds: number[]): Promise<string[]> {
  if (!managerBranchIds.length) return [];
  const rows = await db
    .selectDistinct({ userId: userBranches.userId })
    .from(userBranches)
    .where(inArray(userBranches.branchId, managerBranchIds));
  return rows.map((row) => row.userId);
}

router.get(
  "/users",
  requireAppUser,
  requireRoles("admin", "manager", "order_reception"),
  async (req, res): Promise<void> => {
    const user = req.appUser!;
    const visibleIds =
      user.role === "admin" ? null : await visibleUserIds(user.branchIds);
    if (visibleIds && !visibleIds.length) {
      res.json(ListAppUsersResponse.parse([]));
      return;
    }
    const profiles = await db
      .select()
      .from(appUsers)
      .where(visibleIds ? inArray(appUsers.id, visibleIds) : undefined)
      .orderBy(appUsers.email);
    const userMap = await getAppUsersByIds(profiles.map((profile) => profile.id));
    const visibleUsers = profiles.map((profile) => {
      const mapped = userMap.get(profile.id) ?? serializeAppUser(profile, []);
      return user.role === "admin"
        ? mapped
        : { ...mapped, branchIds: mapped.branchIds.filter((id) => user.branchIds.includes(id)) };
    });
    res.json(
      ListAppUsersResponse.parse(visibleUsers),
    );
  },
);

router.get(
  "/users/invitations",
  requireAppUser,
  requireRoles("admin", "manager"),
  async (req, res): Promise<void> => {
    const user = req.appUser!;
    const invites = await db.select().from(userInvitations).orderBy(userInvitations.createdAt);
    let visible = invites;
    if (user.role !== "admin") {
      if (!user.branchIds.length) {
        visible = [];
      } else {
        const assigned = await db
          .selectDistinct({ invitationId: invitationBranches.invitationId })
          .from(invitationBranches)
          .where(inArray(invitationBranches.branchId, user.branchIds));
        const visibleIds = new Set(assigned.map((row) => row.invitationId));
        visible = invites.filter((invite) => visibleIds.has(invite.id));
      }
    }
    const memberships = visible.length
      ? await db
          .select()
          .from(invitationBranches)
          .where(inArray(invitationBranches.invitationId, visible.map((invite) => invite.id)))
      : [];
    const branchesByInvite = new Map<number, number[]>();
    for (const membership of memberships) {
      const ids = branchesByInvite.get(membership.invitationId) ?? [];
      ids.push(membership.branchId);
      branchesByInvite.set(membership.invitationId, ids);
    }
    res.json(
      ListUserInvitationsResponse.parse(
        visible.map((invite) => ({
          id: invite.id,
          email: invite.email,
          role: invite.role,
          branchIds: branchesByInvite.get(invite.id) ?? [],
          createdAt: toIso(invite.createdAt),
        })),
      ),
    );
  },
);

router.post(
  "/users/invitations",
  requireAppUser,
  requireRoles("admin", "manager"),
  async (req, res): Promise<void> => {
    const parsed = CreateUserInvitationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const user = req.appUser!;
    const email = normalizeEmail(parsed.data.email);
    if (user.role !== "admin" && parsed.data.role === "admin") {
      res.status(403).json({ error: "Only an administrator can invite another administrator." });
      return;
    }
    const branchIds = [...new Set(parsed.data.branchIds)];
    if (user.role !== "admin" && !branchIds.length) {
      res.status(400).json({ error: "Choose at least one branch for this invitation." });
      return;
    }
    if (
      branchIds.some((id) => !user.branchIds.includes(id) && user.role !== "admin")
    ) {
      res.status(403).json({ error: "You can only assign your own branches." });
      return;
    }
    for (const branchId of branchIds) {
      if (!(await branchExists(branchId))) {
        res.status(400).json({ error: "Choose active branches only." });
        return;
      }
    }
    const [existingUser] = await db
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(sql`lower(${appUsers.email}) = ${email}`)
      .limit(1);
    if (existingUser) {
      res.status(409).json({ error: "This email already has app access." });
      return;
    }
    try {
      const invitation = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(userInvitations)
          .values({ email, role: parsed.data.role, invitedBy: user.id })
          .returning();
        if (branchIds.length) {
          await tx
            .insert(invitationBranches)
            .values(branchIds.map((branchId) => ({ invitationId: created.id, branchId })));
        }
        return created;
      });
      res.status(201).json(
        CreateUserInvitationResponse.parse({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          branchIds,
          createdAt: toIso(invitation.createdAt),
        }),
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        res.status(409).json({ error: "An invitation for this email already exists." });
        return;
      }
      throw error;
    }
  },
);

router.delete(
  "/users/invitations/:invitationId",
  requireAppUser,
  requireRoles("admin", "manager"),
  async (req, res): Promise<void> => {
    const params = RevokeUserInvitationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [invite] = await db
      .delete(userInvitations)
      .where(eq(userInvitations.id, params.data.invitationId))
      .returning({ id: userInvitations.id });
    if (!invite) {
      res.status(404).json({ error: "Invitation not found." });
      return;
    }
    res.status(204).end();
  },
);

router.patch(
  "/users/:userId",
  requireAppUser,
  requireRoles("admin", "manager"),
  async (req, res): Promise<void> => {
    const params = UpdateAppUserParams.safeParse(req.params);
    const parsed = UpdateAppUserBody.safeParse(req.body);
    if (!params.success || !parsed.success || !Object.keys(parsed.data ?? {}).length) {
      res.status(400).json({ error: "Enter a valid employee update." });
      return;
    }
    const actor = req.appUser!;
    const [target] = await db
      .select()
      .from(appUsers)
      .where(eq(appUsers.id, params.data.userId))
      .limit(1);
    if (!target) {
      res.status(404).json({ error: "Employee not found." });
      return;
    }
    const targetBranchRows = await db
      .select({ branchId: userBranches.branchId })
      .from(userBranches)
      .where(eq(userBranches.userId, target.id));
    const targetBranchIds = targetBranchRows.map((row) => row.branchId);
    if (actor.role !== "admin") {
      if (target.role === "admin" || parsed.data.role === "admin") {
        res.status(403).json({ error: "Only an administrator can change administrator access." });
        return;
      }
      if (!targetBranchIds.some((id) => actor.branchIds.includes(id))) {
        res.status(403).json({ error: "You can only manage employees in your branches." });
        return;
      }
    }
    if (
      actor.role !== "admin" &&
      parsed.data.branchIds?.some((branchId) => !actor.branchIds.includes(branchId))
    ) {
      res.status(403).json({ error: "You can only assign your own branches." });
      return;
    }
    let updatedBranchIds: number[] | undefined;
    if (parsed.data.branchIds) {
      const requestedBranchIds = [...new Set(parsed.data.branchIds)];
      for (const branchId of requestedBranchIds) {
        if (!(await branchExists(branchId, false))) {
          res.status(400).json({ error: "Choose branches that exist." });
          return;
        }
      }
      updatedBranchIds =
        actor.role === "admin"
          ? requestedBranchIds
          : [
              ...new Set([
                ...targetBranchIds.filter((id) => !actor.branchIds.includes(id)),
                ...requestedBranchIds,
              ]),
            ];
    }
    if (target.role === "admin" && target.status === "active") {
      const isRemovingAdmin =
        (parsed.data.role !== undefined && parsed.data.role !== "admin") ||
        parsed.data.status === "suspended";
      if (isRemovingAdmin) {
        const [adminCount] = await db
          .select({ value: sql<number>`count(*)::int` })
          .from(appUsers)
          .where(and(eq(appUsers.role, "admin"), eq(appUsers.status, "active")));
        if (Number(adminCount?.value ?? 0) <= 1) {
          res.status(409).json({ error: "At least one active administrator must remain." });
          return;
        }
      }
    }
    const updated = await db.transaction(async (tx) => {
      if (updatedBranchIds) {
        await tx.delete(userBranches).where(eq(userBranches.userId, target.id));
        if (updatedBranchIds.length) {
          await tx.insert(userBranches).values(
            updatedBranchIds.map((branchId) => ({ userId: target.id, branchId })),
          );
        }
      }
      const [saved] = await tx
        .update(appUsers)
        .set({
          role: parsed.data.role,
          status: parsed.data.status,
          updatedAt: new Date(),
        })
        .where(eq(appUsers.id, target.id))
        .returning();
      return saved;
    });
    const mapped = await getAppUsersByIds([updated.id]);
    const serialized = mapped.get(updated.id) ?? serializeAppUser(updated, []);
    res.json(
      UpdateAppUserResponse.parse(
        actor.role === "admin"
          ? serialized
          : {
              ...serialized,
              branchIds: serialized.branchIds.filter((id) => actor.branchIds.includes(id)),
            },
      ),
    );
  },
);

export default router;
