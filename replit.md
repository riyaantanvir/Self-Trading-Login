# Self Treding - Crypto Trading Platform

## Overview
A Binance-style simulated crypto trading platform with real-time market data from Binance production WebSocket API. Users can view live coin prices, execute dummy trades, and track their portfolio.

## Tech Stack
- Frontend: React + Vite + TypeScript + TailwindCSS + shadcn/ui
- Backend: Express.js + TypeScript
- Database: PostgreSQL with Drizzle ORM
- Routing: wouter
- State: TanStack React Query
- Charts: lightweight-charts (TradingView)

## Architecture
- Real-time WebSocket: Server connects to `wss://data-stream.binance.vision` for live miniTicker data
- Server relays aggregated ticker data to frontend clients every 1 second via `/ws/market`
- Chart data (klines/candlestick) fetched from `https://data-api.binance.vision/api/v3/klines`
- REST fallback: `/api/market/tickers` returns cached live data when WebSocket unavailable
- Simulated trading with $100,000 starting balance for admin
- Portfolio tracking with P&L calculations

## Key Routes
- `/auth` - Login page
- `/` - Market overview (Binance-style coin table with live prices)
- `/trade/:symbol` - Token detail page (candlestick chart, order book, trade panel)
- `/portfolio` - Holdings and P&L
- `/history` - Trade history

## API Endpoints
- `GET /api/market/tickers` - Live cached ticker data (from Binance WS)
- `GET /api/market/klines` - Candlestick chart data from Binance (params: symbol, interval, limit)
- `WS /ws/market` - WebSocket relay for real-time ticker updates
- `POST /api/login` - Login
- `POST /api/logout` - Logout
- `GET /api/user` - Current user
- `GET /api/trades` - User trades
- `POST /api/trades` - Execute trade (buy/sell, min 5 USDT)
- `GET /api/portfolio` - User portfolio holdings
- `GET /api/watchlist` - User's watchlisted coins
- `POST /api/watchlist` - Add coin to watchlist (body: { symbol })
- `DELETE /api/watchlist/:symbol` - Remove coin from watchlist

## Admin Credentials
- Username: Admin
- Password: Admin

## Recent Changes
- Feb 2026: Added watchlist feature with database persistence, 3-dot action menu on dashboard
- Feb 2026: Improved trade panel with USDT/Token toggle, min 5 USDT, sell shows holdings
- Feb 2026: Added token detail page with TradingView candlestick charts, order book, trade panel
- Feb 2026: Implemented real-time WebSocket data from Binance production API (data-stream.binance.vision)
- Feb 2026: Built initial Binance-style trading platform
