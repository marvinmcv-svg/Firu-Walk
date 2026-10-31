import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Query logging is opt-in (LOG_QUERIES=true): it is far too noisy for production logs.
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.LOG_QUERIES === 'true' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
