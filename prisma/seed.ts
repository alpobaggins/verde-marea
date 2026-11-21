import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "bcryptjs";
import { PrismaClient } from "./generated/client/client";
import { Role } from "./generated/client/enums";

const accounts = [
  {
    email: "super-admin@verde-marea.test",
    name: "Demo Super Admin",
    role: Role.super_admin,
    passwordVariable: "SEED_SUPER_ADMIN_PASSWORD",
  },
  {
    email: "admin@verde-marea.test",
    name: "Demo Admin",
    role: Role.admin,
    passwordVariable: "SEED_ADMIN_PASSWORD",
  },
  {
    email: "user@verde-marea.test",
    name: "Demo User",
    role: Role.user,
    passwordVariable: "SEED_USER_PASSWORD",
  },
] as const;

const tables = [
  { label: "Demo 01", capacity: 2 },
  { label: "Demo 02", capacity: 2 },
  { label: "Demo 03", capacity: 4 },
  { label: "Demo 04", capacity: 6 },
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`Set ${name} before running the Verde Marea seed.`);
  }
  return value;
}

async function main() {
  const connectionString = requireEnv("DATABASE_URL");
  const users = await Promise.all(
    accounts.map(async ({ passwordVariable, ...account }) => {
      const password = requireEnv(passwordVariable);
      if (Buffer.byteLength(password, "utf8") > 72) {
        throw new Error(`${passwordVariable} exceeds bcrypt's 72-byte limit.`);
      }

      return { ...account, passwordHash: await hash(password, 12) };
    }),
  );

  const prisma = new PrismaClient({
    // Interpret timestamps bound by the adapter as UTC in this session.
    adapter: new PrismaPg({ connectionString, options: "-c TimeZone=UTC" }),
  });

  try {
    // Insert only missing fixtures so a rerun preserves existing data.
    const [insertedUsers, insertedTables, insertedClosures] = await prisma.$transaction([
      prisma.user.createMany({ data: users, skipDuplicates: true }),
      prisma.table.createMany({ data: tables, skipDuplicates: true }),
      prisma.availabilityClosure.createMany({
        data: {
          kind: "window",
          startsAt: new Date("2026-01-06T12:00:00+03:00"),
          endsAt: new Date("2026-01-06T13:30:00+03:00"),
        },
        skipDuplicates: true,
      }),
    ]);

    console.log(
      `Seed inserted: ${insertedUsers.count} users, ${insertedTables.count} tables, ${insertedClosures.count} closures.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const isInputError = error instanceof Error &&
    (error.message.startsWith("Set ") || error.message.endsWith("72-byte limit."));
  console.error(isInputError
    ? error.message
    : "Seed failed. Check the Verde Marea database connection and migration status.");
  process.exitCode = 1;
});
