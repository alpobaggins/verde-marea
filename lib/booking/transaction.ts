import { Prisma } from "../../prisma/generated/client/client";
import { getPrisma } from "../db";

const maxAttempts = 3;

function normalizeTransactionError(error: unknown) {
  // Prisma's pg adapter can expose the same P2034 conflict directly from COMMIT.
  if (error instanceof Error && error.name === "DriverAdapterError") {
    const cause = error.cause;
    if (cause && typeof cause === "object" && "kind" in cause && cause.kind === "TransactionWriteConflict"
      && "originalCode" in cause && (cause.originalCode === "40001" || cause.originalCode === "40P01")) {
      return new Prisma.PrismaClientKnownRequestError(error.message, {
        code: "P2034", clientVersion: Prisma.prismaVersion.client,
      });
    }
  }
  return error;
}

export async function bookingTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  const prisma = getPrisma();
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: "Serializable" });
    } catch (failure) {
      const error = normalizeTransactionError(failure);
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034") throw error;
      if (attempt === maxAttempts) return { status: "concurrent_change" } as const;
    }
  }
}
