import fetch from 'node-fetch';

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const RPC_ENDPOINT = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const METEORA_API_BASE = 'https://dlmm.datapi.meteora.ag';
const POSITION_V2_PROGRAM = 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo';

// ============================================================================
// LOGGING
// ============================================================================
function writeLog(message: string): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

// ============================================================================
// TYPES
// ============================================================================
interface DLMMPosition {
  positionAddress: string
  lbPair: string
  owner: string
  lowerBinId: number
  upperBinId: number
  totalClaimedFeeXAmount: number
  totalClaimedFeeYAmount: number
  createdAt?: number
  currentValue?: number
  inRange?: boolean
}

interface DLMMPool {
  address: string
  name: string
  tokenX: string
  tokenY: string
  liquidity: number
  volume24h: number
  fees24h: number
  apr: number
  url: string
}

interface PaginatedResponse<T> {
  total: number
  pages: number
  current_page: number
  page_size: number
  data: T[]
}

// ============================================================================
// CACHE
// ============================================================================
interface CacheEntry<T> {
  data: T
  timestamp: number
}

const cache = new Map<string, CacheEntry<any>>();
const CACHE_TTL = 60000; // 1 minute

function getCache<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  
  const isExpired = Date.now() - entry.timestamp > CACHE_TTL;
  if (isExpired) {
    cache.delete(key);
    return null;
  }
  
  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
}

// ============================================================================
// RATE LIMITING
// ============================================================================
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3
): Promise<T> {
  let lastError: any;
  
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < retries - 1) {
        const backoff = Math.pow(2, i) * 1000;
        await delay(backoff);
      }
    }
  }
  
  throw lastError;
}

// ============================================================================
// POSITION FETCHING
// ============================================================================
async function fetchPositionsForWallets(walletAddresses: string[]): Promise<Record<string, DLMMPosition[]>> {
  if (walletAddresses.length === 0) return {};

  writeLog(`Fetching DLMM positions for ${walletAddresses.length} wallet(s)`);

  try {
    const requests = walletAddresses.map((address, index) => ({
      jsonrpc: '2.0',
      id: index + 1,
      method: 'getProgramAccounts',
      params: [
        POSITION_V2_PROGRAM,
        {
          encoding: 'base64',
          filters: [
            {
              memcmp: {
                offset: 8,
                bytes: address,
              },
            },
          ],
        },
      ],
    }));

    const response = await withRetry(() =>
      fetch(RPC_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requests),
      })
    );

    if (!response.ok) {
      writeLog(`✗ RPC request failed: ${response.status}`);
      return {};
    }

    const results = await response.json() as any;
    const positionsByWallet: Record<string, DLMMPosition[]> = {};

    if (Array.isArray(results)) {
      results.forEach((result: any, index: number) => {
        const walletAddress = walletAddresses[index];

        if (result.result && Array.isArray(result.result)) {
          positionsByWallet[walletAddress] = result.result.map((account: any) => ({
            positionAddress: account.pubkey,
            lbPair: 'Unknown',
            owner: walletAddress,
            lowerBinId: 0,
            upperBinId: 0,
            totalClaimedFeeXAmount: 0,
            totalClaimedFeeYAmount: 0,
            createdAt: Date.now(),
            currentValue: 0,
            inRange: true,
          }));
          
          writeLog(`✓ Found ${positionsByWallet[walletAddress].length} positions for ${walletAddress.slice(0, 8)}...`);
        } else {
          positionsByWallet[walletAddress] = [];
        }
      });
    }

    return positionsByWallet;
  } catch (error) {
    writeLog(`✗ Error fetching positions: ${error}`);
    return {};
  }
}

// ============================================================================
// POOL FETCHING
// ============================================================================
async function fetchPools(page: number, search?: string): Promise<{ pools: DLMMPool[], total: number, pages: number }> {
  const pageSize = 20;
  const cacheKey = `pools:${page}:${search || 'all'}`;
  const cached = getCache<{ pools: DLMMPool[], total: number, pages: number }>(cacheKey);
  
  if (cached) {
    writeLog(`✓ Cache hit for pools page ${page} search="${search || 'none'}"`);
    return cached;
  }

  writeLog(`Fetching pools - page ${page}, search="${search || 'none'}"`);

  try {
    await delay(100); // Rate limit protection

    const response = await withRetry(() =>
      fetch(`${METEORA_API_BASE}/pools?page=${page}&page_size=${pageSize}`)
    );

    if (!response.ok) {
      writeLog(`✗ Meteora API failed: ${response.status}`);
      return { pools: [], total: 0, pages: 0 };
    }

    const data: PaginatedResponse<any> = await response.json() as any;

    if (!data.data || !Array.isArray(data.data)) {
      writeLog(`✗ Unexpected API response format`);
      return { pools: [], total: 0, pages: 0 };
    }

    let pools = data.data.map((pool: any) => ({
      address: pool.address || '',
      name: pool.name || 'Unknown Pool',
      tokenX: pool.mint_x || '',
      tokenY: pool.mint_y || '',
      liquidity: parseFloat(pool.liquidity || '0'),
      volume24h: parseFloat(pool.trade_volume_24h || '0'),
      fees24h: parseFloat(pool.fees_24h || '0'),
      apr: parseFloat(pool.apr || '0'),
      url: `https://app.meteora.ag/dlmm/${pool.address}`,
    }));

    // Filter by search if provided
    if (search && search.trim()) {
      const searchLower = search.toLowerCase().trim();
      pools = pools.filter((pool: DLMMPool) => {
        const nameLower = pool.name.toLowerCase();
        return nameLower.includes(searchLower);
      });
    }

    const result = {
      pools,
      total: search ? pools.length : data.total,
      pages: search ? Math.ceil(pools.length / pageSize) : data.pages,
    };

    setCache(cacheKey, result);
    writeLog(`✓ Fetched ${pools.length} pools`);

    return result;
  } catch (error) {
    writeLog(`✗ Error fetching pools: ${error}`);
    return { pools: [], total: 0, pages: 0 };
  }
}

// ============================================================================
// HANDLER
// ============================================================================
export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { type, addresses, page, search } = req.query;

  if (!HELIUS_API_KEY) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    // POSITIONS
    if (type === 'positions') {
      if (!addresses || typeof addresses !== 'string') {
        return res.status(400).json({ error: 'Addresses required' });
      }

      const walletAddresses = addresses.split(',').map((a: string) => a.trim()).filter(Boolean);
      const positions = await fetchPositionsForWallets(walletAddresses);

      return res.status(200).json({ positions });
    }

    // POOLS
    if (type === 'pools') {
      const pageNum = parseInt(page as string) || 1;
      const searchTerm = search as string || '';

      const result = await fetchPools(pageNum, searchTerm);

      return res.status(200).json(result);
    }

    return res.status(400).json({ error: 'Invalid type parameter' });
  } catch (error) {
    writeLog(`✗ Handler error: ${error}`);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: String(error)
    });
  }
}