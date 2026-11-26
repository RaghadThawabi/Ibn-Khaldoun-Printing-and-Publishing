import { clerkClient, getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  appUsers,
  branches,
  db,
  invitationBranches,
  userBranches,
  userInvitations,
} from "@workspace/db";

export type AppRole =
  | "admin"
  | "manager"
  | "order_reception"
  | "designer"
  | "production_employee"
  | "accountant"
  | "delivery_coordinator";

export type ActiveAppUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: AppRole;
  status: "pending" | "active" | "suspended";
  branchIds: number[];
  createdAt: Date;
};

export type AppProfileState =
  | "active"
  | "pending_invitation"
  | "setup_required"
  | "suspended";

declare global {
  namespace Express {
    interface Request {
      appUser?: ActiveAppUser;
    }
  }
}

const normaliseEmail = (email: string) => email.trim().toLocaleLowerCase("en-US");

async function getBranchIds(userId: string): Promise<number[]> {
  const rows = await db
    .select({ branchId: userBranches.branchId })
    .from(userBranches)
    .where(eq(userBranches.userId, userId));
  return rows.map((row) => row.branchId);
}

async function readAppUser(userId: string): Promise<ActiveAppUser | null> {
  const [profile] = await db.select().from(appUsers).where(eq(appUsers.id, userId)).limit(1);
  if (!profile) return null;
  return {
    ...profile,
    role: profile.role as AppRole,
    status: profile.status as ActiveAppUser["status"],
    branchIds: await getBranchIds(userId),
  };
}

async function hasAdministrator(): Promise<boolean> {
  const [admin] = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(and(eq(appUsers.role, "admin"), eq(appUsers.status, "active")))
    .limit(1);
  return Boolean(admin);
}

async function clerkIdentity(userId: string) {
  const user = await clerkClient.users.getUser(userId);
  const email =
    user.emailAddresses.find((entry) => entry.id === user.primaryEmailAddressId)
      ?.emailAddress ?? user.emailAddresses[0]?.emailAddress;
  if (!email) {
    throw new Error("The signed-in account does not have an email address.");
  }
  return {
    email: normaliseEmail(email),
    firstName: user.firstName,
    lastName: user.lastName,
  };
}

async function provisionFromInvite(
  userId: string,
  identity: Awaited<ReturnType<typeof clerkIdentity>>,
): Promise<void> {
  const configuredAdminEmail = process.env.INITIAL_ADMIN_EMAIL
    ? normaliseEmail(process.env.INITIAL_ADMIN_EMAIL)
    : "";

  if (configuredAdminEmail && identity.email === configuredAdminEmail) {
    await db
      .insert(appUsers)
      .values({
        id: userId,
        email: identity.email,
        firstName: identity.firstName,
        lastName: identity.lastName,
        role: "admin",
        status: "active",
      })
      .onConflictDoNothing();
    return;
  }

  const [invite] = await db
    .select()
    .from(userInvitations)
    .where(sql`lower(${userInvitations.email}) = ${identity.email}`)
    .limit(1);
  if (!invite) return;

  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(appUsers)
      .values({
        id: userId,
        email: identity.email,
        firstName: identity.firstName,
        lastName: identity.lastName,
        role: invite.role,
        status: "active",
      })
      .onConflictDoNothing()
      .returning({ id: appUsers.id });

    if (!created) return;
    const assignedBranches = await tx
      .select({ branchId: invitationBranches.branchId })
      .from(invitationBranches)
      .where(eq(invitationBranches.invitationId, invite.id));
    if (assignedBranches.length) {
      await tx
        .insert(userBranches)
        .values(assignedBranches.map(({ branchId }) => ({ userId, branchId })))
        .onConflictDoNothing();
    }
    await tx.delete(userInvitations).where(eq(userInvitations.id, invite.id));
  });
}

export async function loadAppProfile(
  req: Request,
): Promise<{ state: AppProfileState; hasAdministrator: boolean; user: ActiveAppUser | null }> {
  const userId = getAuth(req).userId;
  if (!userId) throw new Error("AUTH_REQUIRED");

  let profile = await readAppUser(userId);
  if (!profile) {
    const identity = await clerkIdentity(userId);
    await provisionFromInvite(userId, identity);
    profile = await readAppUser(userId);
  }

  const administratorExists = await hasAdministrator();
  if (!profile) {
    return {
      state: administratorExists ? "pending_invitation" : "setup_required",
      hasAdministrator: administratorExists,
      user: null,
    };
  }

  return {
    state: profile.status === "active" ? "active" : profile.status === "suspended" ? "suspended" : "pending_invitation",
    hasAdministrator: administratorExists,
    user: profile,
  };
}

export async function requireAppUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const profile = await loadAppProfile(req);
    if (profile.state !== "active" || !profile.user) {
      res.status(403).json({
        error: "This account is not active for the printing app.",
        code: profile.state,
      });
      return;
    }
    req.appUser = profile.user;
    next();
  } catch (error) {
    if (error instanceof Error && error.message === "AUTH_REQUIRED") {
      res.status(401).json({ error: "Sign-in required.", code: "unauthenticated" });
      return;
    }
    req.log.error({ err: error }, "Could not load the signed-in app profile");
    res.status(503).json({ error: "App access could not be checked. Please try again." });
  }
}

export function requireRoles(...roles: AppRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.appUser) {
      res.status(401).json({ error: "Sign-in required.", code: "unauthenticated" });
      return;
    }
    if (!roles.includes(req.appUser.role)) {
      res.status(403).json({ error: "This action is not available for your role." });
      return;
    }
    next();
  };
}

export function canAccessBranch(user: ActiveAppUser, branchId: number): boolean {
  return user.role === "admin" || user.branchIds.includes(branchId);
}

export async function branchExists(branchId: number, activeOnly = true): Promise<boolean> {
  const [branch] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(
      activeOnly
        ? and(eq(branches.id, branchId), eq(branches.isActive, true))
        : eq(branches.id, branchId),
    )
    .limit(1);
  return Boolean(branch);
}

export async function replaceUserBranches(
  userId: string,
  branchIds: number[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(userBranches).where(eq(userBranches.userId, userId));
    if (branchIds.length) {
      await tx.insert(userBranches).values(
        branchIds.map((branchId) => ({ userId, branchId })),
      );
    }
  });
}
