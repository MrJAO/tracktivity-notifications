import fetch from 'node-fetch';
import { Connection, PublicKey } from '@solana/web3.js';

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

interface WorldCurrenciesData {
  lastUpdated: string;
  rates: Record<string, number>;
}

interface SKRStatsData {
  lastUpdated: string;
  staking: {
    totalStaked: number;
    apy: number;
    inflationRate: number;
  };
}

interface FileUpdate {
  path: string;
  content: any;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const CEX_API_ENDPOINTS = {
  binance: 'https://api.binance.com/api/v3/exchangeInfo',
  coinbase: 'https://api.exchange.coinbase.com/products',
  bybit: 'https://api.bybit.com/v5/market/instruments-info?category=spot',
  upbit: 'https://api.upbit.com/v1/market/all',
  okx: 'https://www.okx.com/api/v5/public/instruments?instType=SPOT',
  kraken: 'https://api.kraken.com/0/public/AssetPairs',
};

const CURRENCY_API_ENDPOINT = 'https://api.exchangerate-api.com/v4/latest/USD';

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const RPC_ENDPOINT = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const SEEKER_STAKING_VAULT = '8isViKbwhuhFhsv2t8vaFL74pKCqaFPQXo1KkeQwZbB8';
const SOLANA_MOBILE_STAKING_SITE = 'https://stake.solanamobile.com/';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = process.env.GITHUB_REPO || '';

const RETENTION_DAYS = 30;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function writeLog(message: string): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

function normalizeSymbol(symbol: string): string {
  return symbol.replace(/[-_\/]/g, '').toUpperCase();
}

async function readJSONFromGitHub<T>(fileName: string): Promise<T> {
  try {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${fileName}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });
    
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }
    
    const data: any = await response.json();
    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error reading ${fileName} from GitHub:`, error);
    throw error;
  }
}

async function commitMultipleFiles(files: FileUpdate[]): Promise<void> {
  try {
    writeLog(`Committing ${files.length} files in a single commit...`);
    
    // Get latest commit SHA
    const refUrl = `https://api.github.com/repos/${GITHUB_REPO}/git/refs/heads/main`;
    const refResponse = await fetch(refUrl, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });
    
    if (!refResponse.ok) {
      throw new Error(`Failed to get ref: ${refResponse.status}`);
    }
    
    const refData: any = await refResponse.json();
    const latestCommitSha = refData.object.sha;
    
    // Get the tree SHA from the latest commit
    const commitUrl = `https://api.github.com/repos/${GITHUB_REPO}/git/commits/${latestCommitSha}`;
    const commitResponse = await fetch(commitUrl, {
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });
    
    if (!commitResponse.ok) {
      throw new Error(`Failed to get commit: ${commitResponse.status}`);
    }
    
    const commitData: any = await commitResponse.json();
    const baseTreeSha = commitData.tree.sha;
    
    // Create blobs for each file
    const tree = [];
    for (const file of files) {
      const content = JSON.stringify(file.content, null, 2);
      const blobUrl = `https://api.github.com/repos/${GITHUB_REPO}/git/blobs`;
      const blobResponse = await fetch(blobUrl, {
        method: 'POST',
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: content,
          encoding: 'utf-8',
        }),
      });
      
      if (!blobResponse.ok) {
        throw new Error(`Failed to create blob for ${file.path}: ${blobResponse.status}`);
      }
      
      const blobData: any = await blobResponse.json();
      tree.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blobData.sha,
      });
    }
    
    // Create new tree
    const treeUrl = `https://api.github.com/repos/${GITHUB_REPO}/git/trees`;
    const treeResponse = await fetch(treeUrl, {
      method: 'POST',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: tree,
      }),
    });
    
    if (!treeResponse.ok) {
      throw new Error(`Failed to create tree: ${treeResponse.status}`);
    }
    
    const treeData: any = await treeResponse.json();
    
    // Create new commit
    const newCommitUrl = `https://api.github.com/repos/${GITHUB_REPO}/git/commits`;
    const newCommitResponse = await fetch(newCommitUrl, {
      method: 'POST',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `Update data files - ${new Date().toISOString()}`,
        tree: treeData.sha,
        parents: [latestCommitSha],
      }),
    });
    
    if (!newCommitResponse.ok) {
      throw new Error(`Failed to create commit: ${newCommitResponse.status}`);
    }
    
    const newCommitData: any = await newCommitResponse.json();
    
    // Update reference
    const updateRefUrl = `https://api.github.com/repos/${GITHUB_REPO}/git/refs/heads/main`;
    const updateRefResponse = await fetch(updateRefUrl, {
      method: 'PATCH',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sha: newCommitData.sha,
      }),
    });
    
    if (!updateRefResponse.ok) {
      throw new Error(`Failed to update ref: ${updateRefResponse.status}`);
    }
    
    writeLog(`✓ Successfully committed ${files.length} files in single commit`);
  } catch (error) {
    console.error('Error committing files:', error);
    throw error;
  }
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// CEX LISTINGS FETCHERS
// ============================================================================

async function fetchBinance(): Promise<string[]> {
  try {
    writeLog('Fetching Binance listings...');
    const response = await fetch(CEX_API_ENDPOINTS.binance);
    const data: any = await response.json();
    
    if (!data.symbols) throw new Error('Invalid Binance API response');
    
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
    const response = await fetch(CEX_API_ENDPOINTS.coinbase);
    const data: any = await response.json();
    
    if (!Array.isArray(data)) throw new Error('Invalid Coinbase API response');
    
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
    const response = await fetch(CEX_API_ENDPOINTS.bybit);
    const data: any = await response.json();
    
    if (!data.result || !data.result.list) throw new Error('Invalid Bybit API response');
    
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
    const response = await fetch(CEX_API_ENDPOINTS.upbit);
    const data: any = await response.json();
    
    if (!Array.isArray(data)) throw new Error('Invalid Upbit API response');
    
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
    const response = await fetch(CEX_API_ENDPOINTS.okx);
    const data: any = await response.json();
    
    if (!data.data) throw new Error('Invalid OKX API response');
    
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
    const response = await fetch(CEX_API_ENDPOINTS.kraken);
    const data: any = await response.json();
    
    if (!data.result) throw new Error('Invalid Kraken API response');
    
    const symbols = Object.keys(data.result);
    
    writeLog(`✓ Kraken: ${symbols.length} trading pairs`);
    return symbols;
  } catch (error) {
    writeLog(`✗ Kraken fetch failed: ${error}`);
    throw error;
  }
}

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

// ============================================================================
// UPDATE FUNCTIONS
// ============================================================================

async function updateCEXListings(): Promise<{ 
  success: boolean; 
  errors: string[];
  files: FileUpdate[];
}> {
  const startTime = new Date().toISOString();
  const errors: string[] = [];
  const files: FileUpdate[] = [];
  
  writeLog('════════════════════════════════════════════════════════════');
  writeLog('Starting CEX Listings Update');
  writeLog('════════════════════════════════════════════════════════════');

  try {
    const oldListings: ExchangeListings = await readJSONFromGitHub('cex-listings.json');
    const newListingsData: NewListingsData = await readJSONFromGitHub('new-listings.json');

    const results: Partial<ExchangeListings['exchanges']> = {};
    const allNewListings: NewListing[] = [];

    const exchanges = [
      { name: 'binance', fn: fetchBinance },
      { name: 'coinbase', fn: fetchCoinbase },
      { name: 'bybit', fn: fetchBybit },
      { name: 'upbit', fn: fetchUpbit },
      { name: 'okx', fn: fetchOKX },
      { name: 'kraken', fn: fetchKraken },
    ];

    for (const { name, fn } of exchanges) {
      try {
        results[name as keyof ExchangeListings['exchanges']] = await fn();
        const detected = await detectNewListings(
          oldListings.exchanges[name as keyof ExchangeListings['exchanges']],
          results[name as keyof ExchangeListings['exchanges']]!,
          name.charAt(0).toUpperCase() + name.slice(1)
        );
        allNewListings.push(...detected);
        if (detected.length > 0) {
          writeLog(`🆕 ${name}: ${detected.length} new listing(s)`);
        }
      } catch (error) {
        errors.push(`${name}: ${error}`);
        results[name as keyof ExchangeListings['exchanges']] = oldListings.exchanges[name as keyof ExchangeListings['exchanges']];
      }
    }

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
    files.push({ path: 'cex-listings.json', content: updatedListings });

    const combinedListings = [...newListingsData.listings, ...allNewListings];
    const cleanedListings = cleanOldListings(combinedListings);
    
    const updatedNewListings: NewListingsData = {
      lastChecked: new Date().toISOString(),
      listings: cleanedListings,
    };
    files.push({ path: 'new-listings.json', content: updatedNewListings });

    const oldStatus = await readJSONFromGitHub<StatusData>('status.json');
    const status: StatusData = {
      lastRun: startTime,
      lastSuccessfulRun: errors.length === 0 ? startTime : oldStatus.lastSuccessfulRun,
      status: errors.length === 0 ? 'success' : errors.length < 6 ? 'partial_success' : 'failed',
      errors: errors,
    };
    files.push({ path: 'status.json', content: status });

    writeLog(`✓ CEX Update Complete: ${allNewListings.length} new listing(s)`);
    
    return { success: errors.length === 0, errors, files };
  } catch (error) {
    writeLog(`✗ CEX Critical error: ${error}`);
    return { success: false, errors: [`Critical: ${error}`], files };
  }
}

async function updateWorldCurrencies(): Promise<{ 
  success: boolean; 
  error?: string;
  file?: FileUpdate;
}> {
  writeLog('════════════════════════════════════════════════════════════');
  writeLog('Starting World Currencies Update');
  writeLog('════════════════════════════════════════════════════════════');

  try {
    const response = await fetch(CURRENCY_API_ENDPOINT);
    
    if (!response.ok) {
      throw new Error(`API returned status ${response.status}`);
    }

    const data: any = await response.json();
    
    if (!data.rates) {
      throw new Error('Invalid API response - missing rates');
    }

    writeLog(`✓ Fetched ${Object.keys(data.rates).length} currency rates`);

    const allRates: Record<string, number> = { USD: 1.0, ...data.rates };

    const worldCurrenciesData: WorldCurrenciesData = {
      lastUpdated: new Date().toISOString(),
      rates: allRates,
    };

    writeLog(`✓ World Currencies Update Complete: ${Object.keys(allRates).length} currencies`);
    
    return { 
      success: true, 
      file: { path: 'world-currencies.json', content: worldCurrenciesData }
    };
  } catch (error) {
    writeLog(`✗ World Currencies error: ${error}`);
    return { success: false, error: String(error) };
  }
}

async function updateSKRStats(): Promise<{ 
  success: boolean; 
  error?: string;
  file?: FileUpdate;
}> {
  writeLog('════════════════════════════════════════════════════════════');
  writeLog('Starting SKR Stats Update');
  writeLog('════════════════════════════════════════════════════════════');

  try {
    if (!HELIUS_API_KEY) {
      throw new Error('HELIUS_API_KEY environment variable not set');
    }

    const response = await fetch(SOLANA_MOBILE_STAKING_SITE);
    if (!response.ok) {
      throw new Error(`Failed to fetch staking site: ${response.status}`);
    }

    const html = await response.text();
    
    const apyPatterns = [
      /Earn\s+(\d+\.?\d*)\s*%\s+APY/i,
      /Current\s+Yield[^0-9]*(\d+\.?\d*)\s*%/i,
      /APY\s*\(current\)[^0-9]*(\d+\.?\d*)\s*%/i,
    ];
    
    const inflationPatterns = [
      /Inflation\s+Rate[^0-9]*(\d+\.?\d*)\s*%/i,
      /inflation.*?(\d+\.?\d*)\s*%/i,
    ];
    
    let apy: number | null = null;
    let inflationRate: number | null = null;
    
    for (const pattern of apyPatterns) {
      const match = html.match(pattern);
      if (match) {
        apy = parseFloat(match[1]);
        break;
      }
    }
    
    for (const pattern of inflationPatterns) {
      const match = html.match(pattern);
      if (match) {
        inflationRate = parseFloat(match[1]);
        break;
      }
    }
    
    if (apy === null || inflationRate === null) {
      writeLog('⚠ Using fallback values: APY 20.7%, Inflation 10.0%');
      apy = 20.7;
      inflationRate = 10.0;
    }

    await delay(2000);
    
    const connection = new Connection(RPC_ENDPOINT, 'confirmed');
    const vaultPubkey = new PublicKey(SEEKER_STAKING_VAULT);
    
    const vaultInfo = await connection.getParsedAccountInfo(vaultPubkey);
    
    let totalStaked = 0;
    if (vaultInfo.value && 'parsed' in vaultInfo.value.data) {
      totalStaked = vaultInfo.value.data.parsed.info.tokenAmount.uiAmount || 0;
      writeLog(`✓ Total Staked: ${totalStaked.toLocaleString()} SKR`);
    } else {
      throw new Error('Could not parse vault balance');
    }
    
    const skrStats: SKRStatsData = {
      lastUpdated: new Date().toISOString(),
      staking: {
        totalStaked,
        apy,
        inflationRate,
      }
    };
    
    writeLog(`✓ SKR Stats Update Complete`);
    
    return { 
      success: true,
      file: { path: 'skr-stats.json', content: skrStats }
    };
  } catch (error) {
    writeLog(`✗ SKR Stats error: ${error}`);
    return { success: false, error: String(error) };
  }
}

// ============================================================================
// VERCEL SERVERLESS HANDLER
// ============================================================================

export default async function handler(req: any, res: any) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  writeLog('🚀 Starting automated update...');
  
  // Collect all file updates
  const allFiles: FileUpdate[] = [];
  
  const cexResult = await updateCEXListings();
  allFiles.push(...cexResult.files);
  
  const currencyResult = await updateWorldCurrencies();
  if (currencyResult.file) {
    allFiles.push(currencyResult.file);
  }
  
  const skrResult = await updateSKRStats();
  if (skrResult.file) {
    allFiles.push(skrResult.file);
  }
  
  // Commit all files in a single commit
  if (allFiles.length > 0) {
    try {
      await commitMultipleFiles(allFiles);
    } catch (error) {
      writeLog(`✗ Failed to commit files: ${error}`);
      return res.status(500).json({
        error: 'Failed to commit files',
        details: String(error),
      });
    }
  }
  
  const allSuccess = cexResult.success && 
                     currencyResult.success && 
                     skrResult.success;

  writeLog('════════════════════════════════════════════════════════════');
  writeLog(`✓ All updates completed - Overall: ${allSuccess ? 'SUCCESS' : 'PARTIAL SUCCESS'}`);
  writeLog('════════════════════════════════════════════════════════════');

  return res.status(200).json({
    timestamp: new Date().toISOString(),
    success: allSuccess,
    filesCommitted: allFiles.length,
    cexListings: { success: cexResult.success, errors: cexResult.errors },
    worldCurrencies: { success: currencyResult.success, error: currencyResult.error },
    skrStats: { success: skrResult.success, error: skrResult.error },
  });
}