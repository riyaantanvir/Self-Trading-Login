import { z } from 'zod';
import { insertUserSchema, insertTradeSchema, users, trades } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
  }),
  unauthorized: z.object({
    message: z.string(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
};

export const api = {
  auth: {
    login: {
      method: 'POST' as const,
      path: '/api/login' as const,
      input: z.object({
        username: z.string(),
        password: z.string(),
      }),
      responses: {
        200: z.custom<typeof users.$inferSelect>(),
        401: errorSchemas.unauthorized,
      },
    },
    logout: {
      method: 'POST' as const,
      path: '/api/logout' as const,
      responses: {
        200: z.void(),
      },
    },
    me: {
      method: 'GET' as const,
      path: '/api/user' as const,
      responses: {
        200: z.custom<typeof users.$inferSelect>(),
        401: errorSchemas.unauthorized,
      },
    },
  },
  trades: {
    list: {
      method: 'GET' as const,
      path: '/api/trades' as const,
      responses: {
        200: z.array(z.custom<typeof trades.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/trades' as const,
      input: insertTradeSchema,
      responses: {
        201: z.custom<typeof trades.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
  },
};
