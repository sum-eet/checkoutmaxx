import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

// Always cache on globalThis so the same instance is reused across
// invocations within the same Vercel warm instance (not just in dev).
globalForPrisma.prisma = prisma;

export default prisma;
