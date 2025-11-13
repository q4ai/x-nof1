# open-nof1.ai

> 📖 **Complete Documentation** | This is the full English documentation. For a quick overview, see the [main README](./README.md).

<div align="center">

[![VoltAgent](https://img.shields.io/badge/Framework-VoltAgent-purple.svg)](https://voltagent.dev)
[![OpenAI Compatible](https://img.shields.io/badge/AI-OpenAI_Compatible-orange.svg)](https://openrouter.ai)
[![OKX](https://img.shields.io/badge/Exchange-OKX-000000.svg?logo=okx&logoColor=white)](https://www.okx.com/)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Node.js](https://img.shields.io/badge/Runtime-Node.js%2020+-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](./LICENSE)

| [English](./README_EN.md) | [简体中文](./README_ZH.md) | [日本語](./README_JA.md) |
|:---:|:---:|:---:|

</div>

## Overview

open-nof1.ai is an AI-powered cryptocurrency automated trading system that deeply integrates large language model intelligence with quantitative trading practices. Built on an Agent framework, the system achieves truly intelligent trading by granting AI complete autonomy in market analysis and trading decisions.

The system follows a **minimal human intervention** design philosophy, abandoning traditional hardcoded trading rules and allowing AI models to autonomously learn and make decisions based on raw market data. It integrates with the OKX exchange (supporting both paper trading and live trading), provides complete perpetual contract trading capabilities, covers mainstream cryptocurrencies such as BTC, ETH, SOL, and supports full automation from data collection, intelligent analysis, risk management to trade execution.

![open-nof1.ai](./public/image.png)

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Key Features](#key-features)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [Commands Reference](#commands-reference)
- [Production Deployment](#production-deployment)
- [Troubleshooting](#troubleshooting)
- [Development Guide](#development-guide)
- [API Documentation](#api-documentation)
- [Contributing](#contributing)
- [License](#license)

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Trading Agent (AI)                    │
│              (DeepSeek V3.2 / Gork4 / Claude)           │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ├─── Market Data Analysis
                  ├─── Position Management
                  └─── Trade Execution Decisions
                  
┌─────────────────┴───────────────────────────────────────┐
│                    VoltAgent Core                       │
│              (Agent Orchestration & Tool Routing)       │
└─────────┬───────────────────────────────────┬───────────┘
          │                                   │
┌─────────┴──────────┐            ┌───────────┴───────────┐
│    Trading Tools   │            │   OKX API Client      │
│                    │            │                       │
│ - Market Data      │◄───────────┤ - Order Management    │
│ - Account Info     │            │ - Position Query      │
│ - Trade Execution  │            │ - Market Data Stream  │
└─────────┬──────────┘            └───────────────────────┘
          │
┌─────────┴──────────┐
│   LibSQL Database  │
│                    │
│ - Account History  │
│ - Trade Signals    │
│ - Agent Decisions  │
└────────────────────┘
```

### Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Framework | [VoltAgent](https://voltagent.dev) | AI Agent orchestration and management |
| AI Provider | OpenAI Compatible API | Supports OpenRouter, OpenAI, DeepSeek and other compatible providers |
| Exchange | [OKX](https://www.okx.com/) | Cryptocurrency trading (paper & live) |
| Database | LibSQL (SQLite) | Local data persistence |
| Web Server | Hono | High-performance HTTP framework |
| Language | TypeScript | Type-safe development |
| Runtime | Node.js 20+ | JavaScript runtime |

### Core Design Philosophy

- **Data-Driven**: Provides raw market data to AI without preprocessing or subjective judgments
- **Autonomous Decision-Making**: AI has complete authority in analysis and trading decisions, without hardcoded strategy constraints
- **Multi-Dimensional Analysis**: Aggregates multi-timeframe data (5m, 15m, 1h, 4h) for comprehensive market view
- **Transparent and Traceable**: Records every decision process for backtesting analysis and strategy optimization
- **Continuous Learning**: System automatically accumulates trading experience and continuously optimizes decision models

## Key Features

### AI-Powered Decision Making

- **Model Support**: DeepSeek V3.2, Grok4, Claude 4.5, Gemini Pro 2.5
- **Data Inputs**: Real-time prices, volume, candlestick patterns, technical indicators
- **Autonomous Analysis**: No pre-configured trading signals
- **Multi-Timeframe**: Aggregates data across multiple time windows
- **Risk Management**: AI-controlled position sizing and leverage management

### Complete Trading Functionality

- **Supported Assets**: BTC, ETH, SOL, BNB, XRP, DOGE, GT, TRUMP, ADA, WLFI
- **Contract Type**: USDT-settled perpetual futures
- **Leverage Range**: 1x to 10x (configurable)
- **Order Types**: Market orders, stop-loss, take-profit
- **Position Direction**: Long and short positions
- **Real-time Execution**: Sub-second order placement via OKX API

### Real-Time Monitoring Interface

- **Web Dashboard**: Accessible at `http://localhost:3100`
- **Account Metrics**: Balance, equity, unrealized PnL
- **Position Overview**: Current holdings, entry prices, leverage
- **Trade History**: Complete transaction log with timestamps
- **AI Decision Log**: Transparency into model reasoning
- **Technical Indicators**: Visualization of market data and signals

### Risk Management System

- **Automated Stop-Loss**: Configurable percentage-based exits
- **Take-Profit Orders**: Automatic profit realization
- **Position Limits**: Maximum exposure per asset
- **Leverage Control**: Configurable maximum leverage
- **Trade Throttling**: Minimum interval between trades
- **Audit Trail**: Complete database logging of all actions

### Production-Ready Deployment

- **Testnet Support**: Risk-free strategy validation
- **Process Management**: PM2 integration for reliability
- **Containerization**: Docker support for isolated deployment
- **Auto-Recovery**: Automatic restart on failures
- **Logging**: Comprehensive error and info logging
- **Health Monitoring**: Built-in health check endpoints

## Quick Start

### Prerequisites

- Node.js >= 20.19.0
- npm or pnpm package manager
- Git version control

### Installation

```bash
# Clone repository
git clone <repository-url>
cd open-nof1.ai

# Install dependencies
npm install

```

### Configuration

Create `.env` file in project root:

```env
# Server Configuration
PORT=3100

# Trading Parameters
TRADING_INTERVAL_MINUTES=5      # Trading loop interval
MAX_LEVERAGE=10                 # Maximum leverage multiplier
MAX_POSITIONS=5                 # Maximum number of positions
MAX_HOLDING_HOURS=36            # Maximum holding time (hours)
INITIAL_BALANCE=2000            # Initial capital in USDT

# Database
DATABASE_URL=file:./db/sqlite.db

# OKX API Credentials (start with paper trading!)
OKX_API_KEY=your_okx_api_key
OKX_API_SECRET=your_okx_api_secret
OKX_API_PASSPHRASE=your_okx_passphrase
OKX_USE_PAPER=true

# AI Model Provider (OpenAI Compatible API)
OPENAI_API_KEY=your_api_key_here
OPENAI_BASE_URL=https://openrouter.ai/api/v1  # Optional, supports OpenRouter, OpenAI, DeepSeek, etc.
AI_MODEL_NAME=deepseek/deepseek-v3.2-exp      # Model name
```

**API Key Acquisition**:
- OpenRouter: https://openrouter.ai/keys
- OpenAI: https://platform.openai.com/api-keys
- DeepSeek: https://platform.deepseek.com/api_keys
- OKX API: https://www.okx.com/account/api

> **Tip**: When `OKX_USE_PAPER=true`, all requests go to OKX's simulated trading environment; switch to live trading only after full validation.

### Database Initialization

```bash
npm run db:init
```

### Start Trading System

```bash
# Development mode with hot reload
npm run dev

# Production mode
npm run trading:start
```

### Access Web Dashboard

Navigate to `http://localhost:3100` in your browser.

## Project Structure

```
open-nof1.ai/
├── src/
│   ├── index.ts                      # Application entry point
│   ├── agents/
│   │   └── tradingAgent.ts           # AI trading agent implementation
│   ├── api/
│   │   └── routes.ts                 # HTTP API endpoints for monitoring
│   ├── database/
│   │   ├── init.ts                   # Database initialization logic
│   │   ├── schema.ts                 # Database schema definitions
│   │   └── sync-from-okx.ts          # Exchange data synchronization
│   ├── scheduler/
│   │   └── tradingLoop.ts            # Trading cycle orchestration
│   ├── services/
│   │   ├── okxClient.ts              # Low-level OKX REST client
│   │   └── okxTradingClient.ts       # High-level OKX trading wrapper
│   │   └── multiTimeframeAnalysis.ts # Multi-timeframe data aggregator
│   ├── tools/
│   │   └── trading/                  # VoltAgent tool implementations
│   │       ├── accountManagement.ts  # Account query and management
│   │       ├── marketData.ts         # Market data retrieval
│   │       └── tradeExecution.ts     # Order placement and management
│   ├── types/
│   │   └── okx.d.ts (optional)       # TypeScript type definitions
│   └── utils/
│       └── timeUtils.ts              # Time/date utility functions
├── public/                           # Web dashboard static files
│   ├── index.html                    # Dashboard HTML
│   ├── app.js                        # Dashboard JavaScript
│   └── style.css                     # Dashboard styles
├── scripts/                          # Operational scripts
│   ├── init-db.sh                    # Database setup script
│   ├── kill-port.sh                  # Service shutdown script
│   └── sync-from-okx.sh              # Data sync script
├── .env                              # Environment configuration
├── db/                               # SQLite data directory
│   └── sqlite.db                     # SQLite database file
├── ecosystem.config.cjs              # PM2 process configuration
├── package.json                      # Node.js dependencies
├── tsconfig.json                     # TypeScript configuration
└── Dockerfile                        # Container build definition
```

## Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `PORT` | HTTP server port | 3141 | No |
| `TRADING_INTERVAL_MINUTES` | Trading loop interval in minutes | 5 | No |
| `MAX_LEVERAGE` | Maximum leverage multiplier | 10 | No |
| `MAX_POSITIONS` | Maximum number of positions | 5 | No |
| `MAX_HOLDING_HOURS` | Maximum holding time in hours | 36 | No |
| `INITIAL_BALANCE` | Initial capital in USDT | 2000 | No |
| `DATABASE_URL` | SQLite database file path | file:./db/sqlite.db | No |
| `OKX_API_KEY` | OKX API key | - | Yes |
| `OKX_API_SECRET` | OKX API secret | - | Yes |
| `OKX_API_PASSPHRASE` | OKX API passphrase | - | Yes |
| `OKX_USE_PAPER` | Use OKX paper trading environment | true | No |
| `OPENAI_API_KEY` | OpenAI compatible API key | - | Yes |
| `OPENAI_BASE_URL` | API base URL | https://openrouter.ai/api/v1 | No |
| `AI_MODEL_NAME` | Model name | deepseek/deepseek-v3.2-exp | No |
| `ACCOUNT_DRAWDOWN_WARNING_PERCENT` | Account drawdown warning threshold: triggers risk alert (%) | 20 | No |
| `ACCOUNT_DRAWDOWN_NO_NEW_POSITION_PERCENT` | Drawdown threshold to stop opening new positions, only allow closing (%) | 30 | No |
| `ACCOUNT_DRAWDOWN_FORCE_CLOSE_PERCENT` | Drawdown threshold to force close all positions to protect remaining funds (%) | 50 | No |

### AI Model Configuration

The system supports any OpenAI API compatible provider:

**OpenRouter** (Recommended, supports multiple models):
```bash
OPENAI_BASE_URL=https://openrouter.ai/api/v1
AI_MODEL_NAME=deepseek/deepseek-v3.2-exp  # or x-ai/grok-4-fast, anthropic/claude-4.5-sonnet
```

**OpenAI**:
```bash
OPENAI_BASE_URL=https://api.openai.com/v1
AI_MODEL_NAME=gpt-4o  # or gpt-4o-mini
```

**DeepSeek**:
```bash
OPENAI_BASE_URL=https://api.deepseek.com/v1
AI_MODEL_NAME=deepseek-chat  # or deepseek-coder
```

Supported models (via different providers):
- `openai/gpt-4o-mini` - Cost-effective option
- `openai/gpt-4o` - High-quality reasoning
- `anthropic/claude-4.5-sonnet` - Strong analytical capabilities
- `google/gemini-pro-2.5` - Multimodal support

To change models, modify the configuration in `src/agents/tradingAgent.ts`.

## Commands Reference

### Development

```bash
# Development mode with hot reload
npm run dev

# Type checking
npm run typecheck

# Linting
npm run lint

# Auto-fix linting issues
npm run lint:fix
```

### Trading System Operations

```bash
# Start trading system
npm run trading:start

# Stop trading system
npm run trading:stop

# Restart trading system
npm run trading:restart
```

### Database Management

```bash
# Initialize database schema
npm run db:init

# Reset database (clear all data)
npm run db:reset

# Check database status
npm run db:status

# Sync data from OKX
npm run db:sync

# Sync position data
npm run db:sync-positions
```

### Docker Container Management

```bash
# Use quick start script (recommended)
npm run docker:start

# Stop container
npm run docker:stop

# View logs
npm run docker:logs

# Build image
npm run docker:build

# Using Docker Compose
npm run docker:up          # Start development environment
npm run docker:down        # Stop development environment
npm run docker:restart     # Restart container

# Production environment
npm run docker:prod:up     # Start production environment
npm run docker:prod:down   # Stop production environment
```

### PM2 Process Management

```bash
# Start daemon process
npm run pm2:start

# Start in development mode
npm run pm2:start:dev

# Stop process
npm run pm2:stop

# Restart process
npm run pm2:restart

# View logs
npm run pm2:logs

# Real-time monitoring
npm run pm2:monit

# List all processes
npm run pm2:list

# Delete process
npm run pm2:delete
```

### Build and Production

```bash
# Build for production
npm run build

# Run production build
npm start
```

## Production Deployment

### PM2 Deployment (Recommended)

PM2 provides robust process management for long-running Node.js applications.

**Installation and Setup**:

```bash
# 1. Install PM2 globally
npm install -g pm2

# 2. Start application
npm run pm2:start

# 3. Enable startup script
pm2 startup
pm2 save

# 4. Monitor logs
npm run pm2:logs
```

**PM2 Configuration** (`ecosystem.config.cjs`):

```javascript
module.exports = {
  apps: [
    {
      name: 'open-nof1.ai',
      script: 'tsx',
      args: '--env-file=.env ./src',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        TZ: 'Asia/Shanghai'
      }
    }
  ]
};
```

### Docker Deployment

**Build and Run**:

```bash
# Build Docker image
docker build -t open-nof1.ai:latest .

# Run container
docker run -d \
  --name open-nof1.ai \
  -p 3141:3141 \
  --env-file .env \
  --restart unless-stopped \
  open-nof1.ai:latest

# View logs
docker logs -f open-nof1.ai

# Stop container
docker stop open-nof1.ai

# Remove container
docker rm open-nof1.ai
```

**Docker Compose** (optional):

```yaml
version: '3.8'
services:
  trading:
    build: .
    container_name: open-nof1.ai
    ports:
      - "3141:3141"
    env_file:
      - .env
    restart: unless-stopped
    volumes:
      - ./db-data:/app/db
```

## Troubleshooting

### Common Issues

#### Database Locked

**Error**: `database is locked`

**Solution**:
```bash
# Stop all running instances
npm run trading:stop
# Or forcefully kill
pkill -f "tsx"

# Remove database lock files
rm -f db/sqlite.db-shm
rm -f db/sqlite.db-wal

# Restart
npm run trading:start
```

#### API Credentials Not Configured

**Error**: `OKX_API_KEY, OKX_API_SECRET and OKX_API_PASSPHRASE must be set in environment variables`

**Solution**:
```bash
# Verify .env file
cat .env | grep OKX_API

# Edit configuration
nano .env
```

#### Port Already in Use

**Error**: `EADDRINUSE: address already in use :::3141`

**Solution**:
```bash
# Method 1: Use stop script
npm run trading:stop

# Method 2: Manually kill process
lsof -ti:3141 | xargs kill -9

# Method 3: Change port in .env
# Set PORT=3142
```

#### Technical Indicators Returning Zero

**Cause**: Candlestick data format mismatch

**Solution**:
```bash
# Pull latest updates
git pull

# Reinstall dependencies
npm install

# Restart system
npm run trading:restart
```

#### AI Model API Errors

**Error**: `OpenAI API error` or connection failure

**Solution**:
- Verify `OPENAI_API_KEY` is correct
- Confirm `OPENAI_BASE_URL` is configured correctly
  - OpenRouter: `https://openrouter.ai/api/v1`
  - OpenAI: `https://api.openai.com/v1`
  - DeepSeek: `https://api.deepseek.com/v1`
- Ensure API key has sufficient credits
- Check network connectivity and firewall settings
- Verify the service provider's status

### Logging

```bash
# View real-time terminal logs
npm run trading:start

# View PM2 logs
npm run pm2:logs

# View historical log files
tail -f logs/trading-$(date +%Y-%m-%d).log

# View PM2 error logs
tail -f logs/pm2-error.log
```

### Database Inspection

```bash
# Check database status
npm run db:status

# Enter SQLite interactive mode
sqlite3 db/sqlite.db

# SQLite commands
.tables                      # List all tables
.schema account_history      # View table schema
SELECT * FROM account_history ORDER BY timestamp DESC LIMIT 10;
.exit                        # Exit SQLite
```

## API Documentation

### REST API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/account` | GET | Current account status and balance |
| `/api/positions` | GET | Active positions |
| `/api/trades` | GET | Trade history |
| `/api/decisions` | GET | AI decision logs |
| `/api/health` | GET | System health check |

### WebSocket Support

Real-time data streaming available for:
- Account updates
- Position changes
- New trade executions
- AI decision events

## Best Practices

### Testing on Testnet

**Critical**: Always test thoroughly on testnet before mainnet deployment.

```bash
# Configure in .env
OKX_USE_PAPER=true
```

Testnet advantages:
- Zero financial risk with virtual funds
- Complete simulation of real trading environment
- Validate AI strategy effectiveness
- Test system reliability under various conditions

### Capital Management

When transitioning to mainnet:
- Start with minimal capital (recommended: 100-500 USDT)
- Monitor performance for several days
- Gradually scale capital based on proven results
- Set appropriate stop-loss percentages

### Regular Backups

```bash
# Backup database
cp db/sqlite.db db/sqlite.db.backup-$(date +%Y%m%d)

# Automated backup script
#!/bin/bash
backup_dir="backups"
mkdir -p $backup_dir
cp db/sqlite.db "$backup_dir/sqlite-$(date +%Y%m%d-%H%M%S).db"
```

### Monitoring and Adjustment

- Regularly review web dashboard metrics
- Analyze AI decision logs for patterns
- Monitor error logs and system alerts
- Adjust parameters based on market conditions

### Risk Control

- Set conservative maximum leverage (recommended: 3-5x)
- Define maximum position size per trade
- Diversify across multiple assets
- Avoid trading during extreme market volatility

### Transitioning to Mainnet

**Warning**: Ensure thorough testnet validation before mainnet deployment.

```bash
# 1. Stop the system
# Press Ctrl+C

# 2. Edit .env file
nano .env

# 3. Update configuration
OKX_USE_PAPER=false
OKX_API_KEY=your_mainnet_api_key
OKX_API_SECRET=your_mainnet_api_secret
OKX_API_PASSPHRASE=your_mainnet_passphrase

# 4. Restart system
npm run trading:start
```

## Resources

### Support Continuous Project Development

If you haven't set up an OKX account yet:

- Visit https://www.okx.com/ and complete identity verification
- Enable the simulated trading environment for strategy validation
- Create dedicated API keys with trading permissions and a strong passphrase

> **Recommendation**: Complete all functional verification in the OKX paper trading environment before switching to live funds.

### External Links

- [VoltAgent Documentation](https://voltagent.dev/docs/)
- [OpenRouter Model Catalog](https://openrouter.ai/models)
- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)
- [DeepSeek API Documentation](https://platform.deepseek.com/api-docs/)
- [OKX API Reference](https://www.okx.com/docs-v5/en/)
- [OKX Simulated Trading Guide](https://www.okx.com/docs-v5/en/#overview-simulated-trading)

## Risk Disclaimer

**This system is provided for educational and research purposes only. Cryptocurrency trading carries substantial risk and may result in financial loss.**

- Always test strategies on testnet first
- Only invest capital you can afford to lose
- Understand and accept all trading risks
- AI decisions do not guarantee profitability
- Users assume full responsibility for all trading activities
- No warranty or guarantee of system performance
- Past performance does not indicate future results

## License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

### Key Terms

- **Free to use**: You may use this software for any purpose
- **Open source requirement**: Any modifications or derivative works must be released under AGPL-3.0
- **Network use**: If you provide this software as a service over a network, you must make the source code available
- **No warranty**: Software is provided "as is" without warranty of any kind

See the [LICENSE](./LICENSE) file for complete terms.

### Why AGPL-3.0?

We chose AGPL-3.0 to ensure:
- The trading community benefits from all improvements
- Transparency in financial software
- Prevention of proprietary forks
- Protection of user freedoms

## Contributing

Contributions are welcome! Please follow these guidelines:

### Reporting Issues

- Use GitHub Issues for bug reports and feature requests
- Provide detailed reproduction steps
- Include system information and logs
- Check for existing issues before creating new ones

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes following [Conventional Commits](https://www.conventionalcommits.org/)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Standards

- Follow existing TypeScript code style
- Add tests for new functionality
- Update documentation as needed
- Ensure all tests pass
- Run linter before committing

### Commit Message Convention

Follow Conventional Commits specification:

```
<type>[optional scope]: <description>

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Test additions or modifications
- `chore`: Build process or auxiliary tool changes
- `ci`: CI/CD configuration changes

---
<div align="center">

[![Star History Chart](https://api.star-history.com/svg?repos=195440/open-nof1.ai&type=Date)](https://star-history.com/#195440/open-nof1.ai&Date)

</div>
