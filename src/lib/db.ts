import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Query logging is opt-in (LOG_QUERIES=true): it is far too noisy for production logs.
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // On Vercel + Neon, POSTGRES_PRISMA_URL is the pooled URL with the
    // Prisma-specific flags (pgbouncer=true, connect_timeout) already set.
    datasourceUrl: process.env.POSTGRES_PRISMA_URL || process.env.DATABASE_URL,
    log: process.env.LOG_QUERIES === 'true' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
