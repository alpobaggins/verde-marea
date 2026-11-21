import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../prisma/generated/client/client";

const globalForPrisma = globalThis as typeof globalThis & { prisma?: PrismaClient };

export function getPrisma() {
  if (!globalForPrisma.prisma) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required.");

    globalForPrisma.prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString, options: "-c TimeZone=UTC" }),
    });
  }

  return globalForPrisma.prisma;
}
