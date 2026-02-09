# Self Treding - Crypto Trading Platform

## Overview
A Binance-style simulated crypto trading platform with real-time market data from Binance Testnet API. Users can view live coin prices, execute dummy trades, and track their portfolio.

## Tech Stack
- Frontend: React + Vite + TypeScript + TailwindCSS + shadcn/ui
- Backend: Express.js + TypeScript
- Database: PostgreSQL with Drizzle ORM
- Routing: wouter
- State: TanStack React Query

## Architecture
- Market data proxied from `https://testnet.binance.vision/api/v3/ticker/24hr`
- Auto-refreshing tickers every 5 seconds
- Simulated trading with $100,000 starting balance for admin
- Portfolio tracking with P&L calculations

## Key Routes
- `/auth` - Login page
- `/` - Market overview (Binance-style coin table)
- `/portfolio` - Holdings and P&L
- `/history` - Trade history

## API Endpoints
- `GET /api/market/tickers` - Proxy to Binance testnet 24hr tickers
- `GET /api/market/klines` - Proxy to Binance testnet klines
- `POST /api/login` - Login
- `POST /api/logout` - Logout
- `GET /api/user` - Current user
- `GET /api/trades` - User trades
- `POST /api/trades` - Execute trade (buy/sell)
- `GET /api/portfolio` - User portfolio holdings

## Admin Credentials
- Username: Admin
- Password: Admin

## Recent Changes
- Feb 2026: Built initial Binance-style trading platform
