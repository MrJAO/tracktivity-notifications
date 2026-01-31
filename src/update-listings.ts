import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// TYPES
// ============================================================================

interface ExchangeListings {
  lastUpdated: string | null;
  exchanges: {
    binance: string[];
    coinbase: string[];
    bybit: string[];
    upbit: string[];
    okx: string[];
    kraken: string[];
  };
}

interface NewListing {
  exchange: string;
  symbol: string;
  detectedAt: string;
}

interface NewListingsData {
  lastChecked: string | null;
  listings: NewListing[];
}

interface StatusData {
  lastRun: string | null;
  lastSuccessfulRun: string | null;
  status: 'success' | 'partial_success' | 'failed' | 'never_run';
  errors: string[];
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const FILES = {
  cexListings: path.join(__dirname, '..', 'cex-listings.json'),
  newListings: path.join(__dirname, '..', 'new-listings.json'),
  status: path.join(__dirname, '..', 'status.json'),
  logs: path.join(__dirname, '..', 'logs'),
};

const API_ENDPOINTS = {
  binance: 'https://api.binance.com/api/v3/exchangeInfo',
  coinbase: 'https://api.exchange.coinbase.com/products',
  bybit: 'https://api.bybit.com/v5/market/instruments-info?category=spot',
  upbit: 'https://api.upbit.com/v1/market/all',
  okx: 'https://www.okx.com/api/v5/public/instruments?instType=SPOT',
  kraken: 'https://api.kraken.com/0/public/AssetPairs',
};

const RETENTION_DAYS = 30; // Keep listings for 30 days

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function normalizeSymbol(symbol: string): string {
  // Remove common separators and convert to uppercase
  return symbol.replace(/[-_\/]/g, '').toUpperCase();
}

function readJSON<T>(filePath: string): T {
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error);
    throw error;
  }
}

function writeJSON(filePath: string, data: any): void {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`✓ Updated ${path.basename(filePath)}`);
  } catch (error) {
    console.error(`Error writing ${filePath}:`, error);
    throw error;
  }
}

function writeLog(message: string): void {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  
  // Ensure logs directory exists
  if (!fs.existsSync(FILES.logs)) {
    fs.mkdirSync(FILES.logs, { recursive: true });
  }

  const logFile = path.join(
    FILES.logs,
    `update-${new Date().toISOString().split('T')[0]}.log`
  );

  fs.appendFileSync(logFile, logMessage, 'utf-8');
  console.log(message);
}

// ============================================================================
// EXCHANGE API FETCHERS
// ============================================================================

async function fetchBinance(): Promise<string[]> {
  try {
    writeLog('Fetching Binance listings...');
    const response = await fetch(API_ENDPOINTS.binance);
    const data: any = await response.json();
    
    if (!data.symbols) {
      throw new Error('Invalid Binance API response');
    }

    const symbols = data.symbols
      .filter((s: any) => s.status === 'TRADING')
      .map((s: any) => s.symbol);
    
    writeLog(`✓ Binance: ${symbols.length} trading pairs`);
    return symbols;
  } catch (error) {
    writeLog(`✗ Binance fetch failed: ${error}`);
    throw error;
  }
}

async function fetchCoinbase(): Promise<string[]> {
  try {
    writeLog('Fetching Coinbase listings...');
    const response = await fetch(API_ENDPOINTS.coinbase);
    const data: any = await response.json();
    
    if (!Array.isArray(data)) {
      throw new Error('Invalid Coinbase API response');
    }

    const symbols = data
      .filter((p: any) => p.status === 'online')
      .map((p: any) => p.id);
    
    writeLog(`✓ Coinbase: ${symbols.length} trading pairs`);
    return symbols;
  } catch (error) {
    writeLog(`✗ Coinbase fetch failed: ${error}`);
    throw error;
  }
}

async function fetchBybit(): Promise<string[]> {
  try {
    writeLog('Fetching Bybit listings...');
    const response = await fetch(API_ENDPOINTS.bybit);
    const data: any = await response.json();
    
    if (!data.result || !data.result.list) {
      throw new Error('Invalid Bybit API response');
    }

    const symbols = data.result.list
      .filter((i: any) => i.status === 'Trading')
      .map((i: any) => i.symbol);
    
    writeLog(`✓ Bybit: ${symbols.length} trading pairs`);
    return symbols;
  } catch (error) {
    writeLog(`✗ Bybit fetch failed: ${error}`);
    throw error;
  }
}

async function fetchUpbit(): Promise<string[]> {
  try {
    writeLog('Fetching Upbit listings...');
    const response = await fetch(API_ENDPOINTS.upbit);
    const data: any = await response.json();
    
    if (!Array.isArray(data)) {
      throw new Error('Invalid Upbit API response');
    }

    const symbols = data
      .filter((m: any) => m.market && m.market.startsWith('KRW-'))
      .map((m: any) => m.market);
    
    writeLog(`✓ Upbit: ${symbols.length} trading pairs`);
    return symbols;
  } catch (error) {
    writeLog(`✗ Upbit fetch failed: ${error}`);
    throw error;
  }
}

async function fetchOKX(): Promise<string[]> {
  try {
    writeLog('Fetching OKX listings...');
    const response = await fetch(API_ENDPOINTS.okx);
    const data: any = await response.json();
    
    if (!data.data) {
      throw new Error('Invalid OKX API response');
    }

    const symbols = data.data
      .filter((i: any) => i.state === 'live')
      .map((i: any) => i.instId);
    
    writeLog(`✓ OKX: ${symbols.length} trading pairs`);
    return symbols;
  } catch (error) {
    writeLog(`✗ OKX fetch failed: ${error}`);
    throw error;
  }
}

async function fetchKraken(): Promise<string[]> {
  try {
    writeLog('Fetching Kraken listings...');
    const response = await fetch(API_ENDPOINTS.kraken);
    const data: any = await response.json();
    
    if (!data.result) {
      throw new Error('Invalid Kraken API response');
    }

    const symbols = Object.keys(data.result);
    
    writeLog(`✓ Kraken: ${symbols.length} trading pairs`);
    return symbols;
  } catch (error) {
    writeLog(`✗ Kraken fetch failed: ${error}`);
    throw error;
  }
}

// ============================================================================
// MAIN LOGIC
// ============================================================================

async function detectNewListings(
  oldSymbols: string[],
  newSymbols: string[],
  exchangeName: string
): Promise<NewListing[]> {
  const oldNormalized = new Set(oldSymbols.map(normalizeSymbol));
  const newListings: NewListing[] = [];

  for (const symbol of newSymbols) {
    const normalized = normalizeSymbol(symbol);
    if (!oldNormalized.has(normalized)) {
      newListings.push({
        exchange: exchangeName,
        symbol: symbol,
        detectedAt: new Date().toISOString(),
      });
    }
  }

  return newListings;
}

function cleanOldListings(listings: NewListing[]): NewListing[] {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

  return listings.filter((listing) => {
    const listingDate = new Date(listing.detectedAt);
    return listingDate >= cutoffDate;
  });
}

async function updateListings(): Promise<void> {
  const startTime = new Date().toISOString();
  const errors: string[] = [];
  
  writeLog('════════════════════════════════════════════════════════════');
  writeLog('Starting CEX Listings Update');
  writeLog('════════════════════════════════════════════════════════════');

  try {
    // Load previous data
    const oldListings: ExchangeListings = readJSON(FILES.cexListings);
    const newListingsData: NewListingsData = readJSON(FILES.newListings);

    // Fetch from all exchanges
    const results: Partial<ExchangeListings['exchanges']> = {};
    const allNewListings: NewListing[] = [];

    // Binance
    try {
      results.binance = await fetchBinance();
      const detected = await detectNewListings(
        oldListings.exchanges.binance,
        results.binance,
        'Binance'
      );
      allNewListings.push(...detected);
      if (detected.length > 0) {
        writeLog(`🆕 Binance: ${detected.length} new listing(s)`);
      }
    } catch (error) {
      errors.push(`Binance: ${error}`);
      results.binance = oldListings.exchanges.binance; // Keep old data
    }

    // Coinbase
    try {
      results.coinbase = await fetchCoinbase();
      const detected = await detectNewListings(
        oldListings.exchanges.coinbase,
        results.coinbase,
        'Coinbase'
      );
      allNewListings.push(...detected);
      if (detected.length > 0) {
        writeLog(`🆕 Coinbase: ${detected.length} new listing(s)`);
      }
    } catch (error) {
      errors.push(`Coinbase: ${error}`);
      results.coinbase = oldListings.exchanges.coinbase;
    }

    // Bybit
    try {
      results.bybit = await fetchBybit();
      const detected = await detectNewListings(
        oldListings.exchanges.bybit,
        results.bybit,
        'Bybit'
      );
      allNewListings.push(...detected);
      if (detected.length > 0) {
        writeLog(`🆕 Bybit: ${detected.length} new listing(s)`);
      }
    } catch (error) {
      errors.push(`Bybit: ${error}`);
      results.bybit = oldListings.exchanges.bybit;
    }

    // Upbit
    try {
      results.upbit = await fetchUpbit();
      const detected = await detectNewListings(
        oldListings.exchanges.upbit,
        results.upbit,
        'Upbit'
      );
      allNewListings.push(...detected);
      if (detected.length > 0) {
        writeLog(`🆕 Upbit: ${detected.length} new listing(s)`);
      }
    } catch (error) {
      errors.push(`Upbit: ${error}`);
      results.upbit = oldListings.exchanges.upbit;
    }

    // OKX
    try {
      results.okx = await fetchOKX();
      const detected = await detectNewListings(
        oldListings.exchanges.okx,
        results.okx,
        'OKX'
      );
      allNewListings.push(...detected);
      if (detected.length > 0) {
        writeLog(`🆕 OKX: ${detected.length} new listing(s)`);
      }
    } catch (error) {
      errors.push(`OKX: ${error}`);
      results.okx = oldListings.exchanges.okx;
    }

    // Kraken
    try {
      results.kraken = await fetchKraken();
      const detected = await detectNewListings(
        oldListings.exchanges.kraken,
        results.kraken,
        'Kraken'
      );
      allNewListings.push(...detected);
      if (detected.length > 0) {
        writeLog(`🆕 Kraken: ${detected.length} new listing(s)`);
      }
    } catch (error) {
      errors.push(`Kraken: ${error}`);
      results.kraken = oldListings.exchanges.kraken;
    }

    // Update cex-listings.json
    const updatedListings: ExchangeListings = {
      lastUpdated: new Date().toISOString(),
      exchanges: {
        binance: results.binance || [],
        coinbase: results.coinbase || [],
        bybit: results.bybit || [],
        upbit: results.upbit || [],
        okx: results.okx || [],
        kraken: results.kraken || [],
      },
    };
    writeJSON(FILES.cexListings, updatedListings);

    // Update new-listings.json
    const combinedListings = [...newListingsData.listings, ...allNewListings];
    const cleanedListings = cleanOldListings(combinedListings);
    
    const updatedNewListings: NewListingsData = {
      lastChecked: new Date().toISOString(),
      listings: cleanedListings,
    };
    writeJSON(FILES.newListings, updatedNewListings);

    // Update status.json
    const status: StatusData = {
      lastRun: startTime,
      lastSuccessfulRun: errors.length === 0 ? startTime : readJSON<StatusData>(FILES.status).lastSuccessfulRun,
      status: errors.length === 0 ? 'success' : errors.length < 6 ? 'partial_success' : 'failed',
      errors: errors,
    };
    writeJSON(FILES.status, status);

    writeLog('════════════════════════════════════════════════════════════');
    writeLog(`Update Complete: ${allNewListings.length} new listing(s) detected`);
    if (errors.length > 0) {
      writeLog(`⚠ ${errors.length} error(s) occurred - check logs for details`);
    }
    writeLog('════════════════════════════════════════════════════════════');

  } catch (error) {
    writeLog(`✗ Critical error: ${error}`);
    
    const status: StatusData = {
      lastRun: startTime,
      lastSuccessfulRun: readJSON<StatusData>(FILES.status).lastSuccessfulRun,
      status: 'failed',
      errors: [`Critical: ${error}`],
    };
    writeJSON(FILES.status, status);
    
    throw error;
  }
}

// ============================================================================
// ENTRY POINT
// ============================================================================

updateListings()
  .then(() => {
    console.log('\n✓ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Script failed:', error);
    process.exit(1);
  });
