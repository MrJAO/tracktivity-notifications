# Tracktivity Notifications & Data Feeds

Public notification, CEX listing, world currency, and SKR staking data feeds for the Tracktivity dApp.

## Structure

### Data Files
- `notifications.json` - App announcements and updates
- `cex-listings.json` - Complete snapshot of all CEX trading pairs
- `new-listings.json` - Recently detected new exchange listings
- `world-currencies.json` - Global fiat exchange rates (USD base)
- `skr-stats.json` - Solana Mobile SKR staking statistics
- `status.json` - Health check and script execution status

### Directories
- `src/` - TypeScript update scripts
- `logs/` - Daily execution logs

## Data Sources

### SKR Stats (update-skr-stats.ts | skr-stats.json)
Real-time Solana Mobile (SKR) staking statistics:
- **Total Staked** - From Seeker Staking Vault
- **APY** - Scraped from stake.solanamobile.com
- **Inflation Rate** - Scraped from stake.solanamobile.com
- **Top 50 Stakers** - Ranked list with balances and percentages

**Update Schedule:** Manual via `npm run update:skr`

**Data Structure:**
```json
{
  "lastUpdated": "2026-02-15T12:00:00.000Z",
  "staking": {
    "totalStaked": 4200000000,
    "apy": 20.7,
    "inflationRate": 10.0,
    "topStakers": [
      {
        "rank": 1,
        "address": "ABC123...",
        "balance": 1000000,
        "percentage": 0.024
      }
    ]
  }
}
```

### World Currencies (update-world-currencies.ts | world-currencies.json)
- Fetches the latest global fiat exchange rates
- Base currency: USD
- Includes all available world currencies
- Updated via ExchangeRate-API

### CEX Listings (update-listings.ts | cex-listings.json | new-listings.json)
Automatically tracks new trading pairs across major exchanges:
- Detects new listings within minutes
- Retains new listings for 30 days
- Includes exchange name, symbol, and detection timestamp

## Notification Types

### General Notifications (notifications.json)
- `update` - App updates
- `promotion` - Paid promotions
- `maintenance` - System maintenance
- `polymarket_starred` - Starred user activities
- `custom` - Other announcements

### CEX Listing Notifications (new-listings.json)
- Automatically detected when new trading pairs appear on exchanges
- Retained for 30 days
- Includes: Exchange name, trading pair symbol, detection timestamp

## Supported Exchanges

- **Binance** - Global spot trading
- **Coinbase** - US-regulated exchange
- **Bybit** - Derivatives and spot
- **Upbit** - South Korean exchange
- **OKX** - Multi-asset exchange
- **Kraken** - Established crypto exchange

## Usage

### Install Dependencies
```bash
npm install
```

### Update Scripts

**Build TypeScript:**
```bash
npm run build
```

**Update CEX Listings:**
```bash
npm run update        # Production (build + run)
npm run dev           # Development (ts-node)
```

**Update World Currencies:**
```bash
npm run update:world  # Production
npm run dev:world     # Development
```

**Update SKR Stats:**
```bash
npm run update:skr    # Production
npm run dev:skr       # Development
```

**Update All Data:**
```bash
npm run update:all    # Production (all scripts)
npm run dev:all       # Development (all scripts)
```

### Environment Variables

Create a `.env` file in the root directory:

```env
HELIUS_API_KEY=your_helius_api_key_here
```

**Required for:**
- `update-skr-stats.ts` - Fetches staking data from Helius RPC

**Get your Helius API key:**
1. Sign up at [helius.dev](https://www.helius.dev/)
2. Create a new project
3. Copy your API key
4. Add to `.env` file

## Data Update Schedule

### Recommended Frequencies
- **CEX Listings:** Every 15-30 minutes (GitHub Actions)
- **World Currencies:** Daily or on-demand
- **SKR Stats:** Every 1-6 hours or on-demand
- **Notifications:** Manual updates as needed

### GitHub Actions Example
```yaml
name: Update Data Feeds
on:
  schedule:
    - cron: '*/30 * * * *'  # Every 30 minutes
  workflow_dispatch:

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm run update:all
        env:
          HELIUS_API_KEY: ${{ secrets.HELIUS_API_KEY }}
      - uses: stefanzweifel/git-auto-commit-action@v4
        with:
          commit_message: "Update data feeds"
```

## Manual Notification Management

Edit `notifications.json` directly to add announcements:

```json
{
  "id": "unique-id",
  "title": "New Feature!",
  "message": "Check out our latest update",
  "date": "2026-02-15",
  "type": "update",
  "isRead": false,
  "isSticky": false,
  "expiresAt": null,
  "metadata": {
    "emoji": "🎉",
    "sections": [
      {
        "type": "text",
        "content": "Feature description here"
      }
    ]
  }
}
```

## API Endpoints

When deployed to Vercel, data is accessible at:

- `https://your-project.vercel.app/notifications.json`
- `https://your-project.vercel.app/cex-listings.json`
- `https://your-project.vercel.app/new-listings.json`
- `https://your-project.vercel.app/world-currencies.json`
- `https://your-project.vercel.app/skr-stats.json`
- `https://your-project.vercel.app/status.json`

## License

MIT

## Author

MrJAO