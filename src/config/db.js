import { PrismaClient } from '@prisma/client';
import { env } from './env.js';

// Single shared Prisma instance — reused across the whole app instead of
// creating a new client (and connection pool) per request.
export const prisma = new PrismaClient({
  log: env.nodeEnv === 'development' ? ['warn', 'error'] : ['error'],
});
