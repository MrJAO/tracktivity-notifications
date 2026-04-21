const METEORA_POOLS_API = 'https://dlmm.datapi.meteora.ag/pools';
const METEORA_POSITIONS_API = 'https://dlmm.datapi.meteora.ag/positions/wallet';

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
// POSITION FETCHING - Using Meteora API
// ============================================================================
async function fetchPositionsForWallets(walletAddresses: string[]): Promise<Record<string, DLMMPosition[]>> {
  if (walletAddresses.length === 0) return {};

  writeLog(`Fetching DLMM positions for ${walletAddresses.length} wallet(s) from Meteora`);

  try {
    const positionsByWallet: Record<string, DLMMPosition[]> = {};

    for (const walletAddress of walletAddresses) {
      try {
        const url = `${METEORA_POSITIONS_API}/${walletAddress}`;
        
        const response = await withRetry(() =>
          fetch(url, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
          })
        );

        if (!response.ok) {
          writeLog(`✗ Meteora API failed for ${walletAddress.slice(0, 8)}...: ${response.status}`);
          positionsByWallet[walletAddress] = [];
          continue;
        }

        const result: any = await response.json();

        if (result.data && Array.isArray(result.data)) {
          positionsByWallet[walletAddress] = result.data.map((pos: any) => ({
            positionAddress: pos.position_address || pos.address || 'Unknown',
            lbPair: pos.pool_address || pos.lb_pair || 'Unknown',
            owner: walletAddress,
            lowerBinId: parseInt(pos.lower_bin_id || pos.lowerBinId || '0'),
            upperBinId: parseInt(pos.upper_bin_id || pos.upperBinId || '0'),
            totalClaimedFeeXAmount: parseFloat(pos.total_claimed_fee_x_amount || pos.totalClaimedFeeXAmount || '0'),
            totalClaimedFeeYAmount: parseFloat(pos.total_claimed_fee_y_amount || pos.totalClaimedFeeYAmount || '0'),
            createdAt: pos.created_at || Date.now(),
            currentValue: parseFloat(pos.current_value || '0'),
            inRange: pos.in_range !== undefined ? pos.in_range : true,
          }));

          writeLog(`✓ Found ${positionsByWallet[walletAddress].length} positions for ${walletAddress.slice(0, 8)}...`);
        } else {
          positionsByWallet[walletAddress] = [];
        }

        await delay(100);
      } catch (error) {
        writeLog(`✗ Error fetching positions for ${walletAddress.slice(0, 8)}...: ${error}`);
        positionsByWallet[walletAddress] = [];
      }
    }

    return positionsByWallet;
  } catch (error) {
    writeLog(`✗ Error fetching positions: ${error}`);
    return {};
  }
}

// ============================================================================
// POOL FETCHING - Using Meteora API
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
    await delay(100);

    const params = new URLSearchParams({
      page: page.toString(),
      page_size: pageSize.toString(),
    });

    if (search && search.trim()) {
      params.append('search', search.trim());
    }

    const url = `${METEORA_POOLS_API}?${params.toString()}`;
    
    const response = await withRetry(() =>
      fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })
    );

    if (!response.ok) {
      writeLog(`✗ Meteora API failed: ${response.status}`);
      return { pools: [], total: 0, pages: 0 };
    }

    const result: any = await response.json();

    if (!result.data || !Array.isArray(result.data)) {
      writeLog(`✗ No pool data in response`);
      return { pools: [], total: 0, pages: 0 };
    }

    const pools: DLMMPool[] = result.data.map((pool: any) => ({
      address: pool.address || '',
      name: pool.name || `${pool.token_x?.symbol || '???'}/${pool.token_y?.symbol || '???'}`,
      tokenX: pool.token_x?.address || pool.tokenXMint || '',
      tokenY: pool.token_y?.address || pool.tokenYMint || '',
      liquidity: parseFloat(pool.tvl || pool.liquidity || '0'),
      volume24h: parseFloat(pool.volume?.['24h'] || pool.volume_24h || '0'),
      fees24h: parseFloat(pool.fees?.['24h'] || pool.fees_24h || '0'),
      apr: parseFloat(pool.apr || pool.fee_apr || '0'),
      url: `https://app.meteora.ag/dlmm/${pool.address}`,
    }));

    const resultData = {
      pools,
      total: result.total || pools.length,
      pages: result.pages || Math.ceil((result.total || pools.length) / pageSize),
    };

    setCache(cacheKey, resultData);
    writeLog(`✓ Fetched ${pools.length} pools`);

    return resultData;
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