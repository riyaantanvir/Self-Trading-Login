import { z } from 'zod';
import { users, trades, portfolio } from './schema';

export const errorSchemas = {
  validation: z.object({ message: z.string() }),
  unauthorized: z.object({ message: z.string() }),
  notFound: z.object({ message: z.string() }),
};

export const api = {
  auth: {
    login: {
      method: 'POST' as const,
      path: '/api/login' as const,
      input: z.object({ username: z.string(), password: z.string() }),
      responses: {
        200: z.custom<typeof users.$inferSelect>(),
        401: errorSchemas.unauthorized,
      },
    },
    logout: {
      method: 'POST' as const,
      path: '/api/logout' as const,
      responses: { 200: z.void() },
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
  market: {
    tickers: {
      method: 'GET' as const,
      path: '/api/market/tickers' as const,
      responses: {
        200: z.array(z.object({
          symbol: z.string(),
          lastPrice: z.string(),
          priceChangePercent: z.string(),
          highPrice: z.string(),
          lowPrice: z.string(),
          volume: z.string(),
          quoteVolume: z.string(),
        })),
      },
    },
    klines: {
      method: 'GET' as const,
      path: '/api/market/klines' as const,
      responses: {
        200: z.array(z.any()),
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
      input: z.object({
        symbol: z.string(),
        type: z.enum(['buy', 'sell']),
        quantity: z.number().positive(),
        price: z.number().positive(),
      }),
      responses: {
        201: z.custom<typeof trades.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
  },
  portfolio: {
    list: {
      method: 'GET' as const,
      path: '/api/portfolio' as const,
      responses: {
        200: z.array(z.custom<typeof portfolio.$inferSelect>()),
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
