# Self Treding - Crypto Trading Platform

## Overview
A Binance-style simulated crypto trading platform with real-time market data from the Binance production WebSocket API. Users can view live coin prices, execute dummy trades, and track their portfolio. The platform aims to provide a comprehensive and realistic cryptocurrency trading simulation environment.

## User Preferences
Not specified.

## System Architecture
The platform is built with a React, Vite, TypeScript, TailwindCSS, and shadcn/ui frontend, an Express.js and TypeScript backend, and a PostgreSQL database with Drizzle ORM. Routing is handled by wouter, and state management by TanStack React Query. Charts are rendered using lightweight-charts (TradingView).

**Key Features:**
-   **Real-time Market Data:** Connects to `wss://data-stream.binance.vision` for live miniTicker data, relayed to clients via `/ws/market` every second. Candlestick data is fetched from `https://data-api.binance.vision/api/v3/klines`. A REST fallback (`/api/market/tickers`) provides cached data if WebSocket is unavailable.
-   **Simulated Trading:** Users start with $100,000 for simulated trades, with a minimum trade size of 5 USDT. Supports various order types: Market, Limit, Stop Market, and Stop Limit, with server-side execution and pending order management.
-   **Portfolio Management:** Tracks user portfolio holdings, P&L calculations (including daily PNL based on a 6AM-6AM window), and trade history.
-   **Futures Trading:** A dedicated futures wallet, leverage from 1x to 125x, Cross and Isolated margin modes, and tracking of long/short positions with liquidation prices, unrealized PnL, and ROE%.
-   **Market Analysis Tools:**
    -   **Charts:** Integrated TradingView-style charts with indicators like Bollinger Bands, RSI (14), and MACD (12,26,9), all time-synced. Charts persist zoom/scroll during data refreshes.
    -   **Market Data APIs:** Provides real-time tickers, klines, order book depth, long/short sentiment, news feed, trend analysis, technical scanner (RSI, EMA, MACD), support/resistance levels, correlation matrix, whale watch, divergence detection, multi-timeframe analysis, volume profile, momentum heatmap, and order flow imbalance.
    -   **Quick Analysis:** Aggregated coin analysis including S/R zones, trends, indicator explanations, sentiment, Fear & Greed Index, and buy/sell verdicts.
-   **User Interaction:**
    -   **Watchlist:** Users can add/remove coins to a personalized watchlist.
    -   **Price Alerts:** Create, view, and delete price alerts with Telegram notification integration. Server-side checking every 3 seconds.
    -   **Smart Signal Alerts:** Background scanner for buy/sell signals near S/R zones, with Telegram alerts and cooldowns.
    -   **Notification System:** Bell icon in the header with unread badges, showing notifications for trades, transfers, and futures actions.
    -   **Binance Pay-style Transfers:** Search users, transfer funds, and view transfer history.
-   **Admin Panel:** Provides user management, balance top-up for users, and API key management (masked display).
-   **UI/UX:** Binance-style interface with professional TradingView chart styling (dark background #131722, muted grids).

## External Dependencies
-   Binance Production WebSocket API (`wss://data-stream.binance.vision`) for real-time market data.
-   Binance Data API (`https://data-api.binance.vision/api/v3/klines`) for historical candlestick data.
-   CryptoCompare API for crypto news feeds.
-   alternative.me API for Fear & Greed Index data.
-   Telegram Bot API for sending price alerts.