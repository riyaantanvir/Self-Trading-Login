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
- `/assets` - Assets overview (Binance-style, total value, today's PNL clickable, holdings list)
- `/pnl` - PNL analysis page (daily calendar, charts, 7D/30D/90D periods, cumulative PNL)
- `/portfolio` - Holdings, P&L, and quick sell
- `/history` - Trade history
- `/alerts` - Price alerts management (create, view, delete alerts)
- `/admin` - Admin panel (admin-only, placeholder for future settings)

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
- `GET /api/portfolio/today-pnl` - Server-calculated Today's PNL (6AM-6AM window, returns totalPnl, perSymbol, startOfDayValue)
- `GET /api/portfolio/pnl-history` - Daily realized PNL history (6AM-6AM window, returns dailyPnl array, cumulativePnl, weeklyPnl)
- `GET /api/watchlist` - User's watchlisted coins
- `POST /api/watchlist` - Add coin to watchlist (body: { symbol })
- `DELETE /api/watchlist/:symbol` - Remove coin from watchlist
- `GET /api/alerts` - User's price alerts
- `POST /api/alerts` - Create alert (body: { symbol, targetPrice, direction, notifyTelegram, alertType?, indicator?, indicatorCondition?, chartInterval? })
- `DELETE /api/alerts/:id` - Delete price alert
- `GET /api/alerts/triggered` - User's triggered alerts
- `POST /api/user/telegram` - Save Telegram bot token and chat ID
- `POST /api/user/telegram/test` - Send test Telegram message

## Admin Credentials
- Username: Admin
- Password: Admin

## Chart Indicators
- Bollinger Bands (BB): Toggle checkbox on chart toolbar, computes 20-period SMA with 2 standard deviation bands (upper=green, middle=orange, lower=red), uses LineSeries from lightweight-charts
- RSI (14): Toggle checkbox, renders in separate sub-panel below main chart with overbought (70) and oversold (30) dashed lines, purple line
- MACD (12,26,9): Toggle checkbox, renders in separate sub-panel with MACD line (blue), signal line (orange), histogram bars (green/red)
- All indicator sub-charts are time-synced with the main candlestick chart

## Recent Changes
- Feb 2026: Added Fear & Greed Index tab on Markets page with visual gauge, today/yesterday/7d comparison, and 30-day history bar chart (data from alternative.me API, cached 5min server-side)
- Feb 2026: Added RSI and MACD indicators with separate sub-panels and time-synced scrolling
- Feb 2026: Added Bollinger Bands indicator to trading charts with toggle checkbox on interval bar
- Feb 2026: Added PNL analysis page (/pnl) with daily calendar view, net worth chart, cumulative PNL chart, profits bar chart, 7D/30D/90D period tabs; Today's PNL on assets page is now clickable to navigate there
- Feb 2026: Fixed Today's PNL to use server-side calculation based on 6AM-6AM window (reverse-computes start-of-day state from current state + today's trades, uses Binance open prices for start-of-day valuation)
- Feb 2026: Added Telegram integration for price alerts (user-configured bot token + chat ID, test message, toggle per alert)
- Feb 2026: Added price alerts feature with DB persistence, server-side checking every 3s, WebSocket notifications, alerts page, and bell icon on token detail for quick alert creation
- Feb 2026: Admin Panel: User Management & Balance Top-up now functional (view all users, add demo USDT via admin endpoints)
- Feb 2026: Added Admin Panel page (admin-only, placeholder sections for user management, balance top-up, etc.)
- Feb 2026: Added Assets page with Binance-style overview (total value, today's PNL, holdings with live data)
- Feb 2026: Added watchlist feature with database persistence, 3-dot action menu on dashboard
- Feb 2026: Improved trade panel with USDT/Token toggle, min 5 USDT, sell shows holdings
- Feb 2026: Added token detail page with TradingView candlestick charts, order book, trade panel
- Feb 2026: Implemented real-time WebSocket data from Binance production API (data-stream.binance.vision)
- Feb 2026: Built initial Binance-style trading platform
