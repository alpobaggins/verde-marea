import { createHash, randomBytes } from "node:crypto";
import { compare, hash } from "bcryptjs";
import { Prisma } from "../../prisma/generated/client/client";
import { getPrisma } from "../db";
import { credentialsSchema, registrationSchema } from "./validation";
import type { z } from "zod";

const bcryptCost = 12;
const sessionDurationMs = 7 * 24 * 60 * 60 * 1000;
// A cost-12 hash keeps the password check comparable when the email is unknown.
const dummyHash = "$2b$12$qLBL7uiHFZNkJz6Wn2SPJeWc0.B5dmZeIxzaJtmJKXCaDOjHJ43pe";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function isSessionToken(token: string | undefined): token is string {
  return token !== undefined && /^[a-f0-9]{64}$/.test(token);
}

export async function registerUser({ name, email, password }: z.infer<typeof registrationSchema>) {
  const passwordHash = await hash(password, bcryptCost);
  try {
    await getPrisma().user.create({
      data: { name, email, passwordHash, role: "user" },
      select: { id: true },
    });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return false;
    }
    throw error;
  }
}

export async function loginUser({ email, password }: z.infer<typeof credentialsSchema>) {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true },
  });

  const matches = await compare(password, user?.passwordHash ?? dummyHash);
  if (!user || !matches) return null;

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + sessionDurationMs);
  await prisma.session.create({
    data: { tokenHash: hashToken(token), userId: user.id, expiresAt },
    select: { tokenHash: true },
  });
  return { token, expiresAt };
}

export async function findSessionUser(
  token: string | undefined,
  tx?: Prisma.TransactionClient,
  now = new Date(),
) {
  if (!isSessionToken(token)) return null;

  const session = await (tx ?? getPrisma()).session.findUnique({
    where: { tokenHash: hashToken(token), expiresAt: { gt: now } },
    select: { user: { select: { id: true, email: true, role: true } } },
  });
  return session?.user ?? null;
}

export async function revokeSession(token: string | undefined) {
  if (!isSessionToken(token)) return;
  await getPrisma().session.deleteMany({ where: { tokenHash: hashToken(token) } });
}
