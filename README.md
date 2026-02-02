# Tracktivity Notifications

Public notification and CEX listing feed for Tracktivity dApp.

## Structure

### Notification Files
- `notifications.json` - App announcements and updates
- `cex-listings.json` - Complete snapshot of all CEX trading pairs
- `new-listings.json` - Recently detected new exchange listings
- `status.json` - Health check and script execution status

### Directories
- `src/` - TypeScript update script
- `logs/` - Daily execution logs

## Notification Types

### General Notifications (notifications.json)
- `update` - App updates
- `promotion` - Paid promotions
- `maintenance` - System maintenance
- `polymarket_starred` - Starred user activities (future)
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
