const METEORA_API_BASE = 'https://dlmm-api.meteora.ag';
const SHYFT_API_KEY = process.env.SHYFT_API_KEY || '';
const SHYFT_GRAPHQL_ENDPOINT = `https://programs.shyft.to/v0/graphql/accounts?api_key=${SHYFT_API_KEY}&network=mainnet-beta`;

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
// POSITION FETCHING - Using SHYFT GraphQL
// ============================================================================
async function fetchPositionsForWallets(walletAddresses: string[]): Promise<Record<string, DLMMPosition[]>> {
  if (walletAddresses.length === 0) return {};
  if (!SHYFT_API_KEY) {
    writeLog('✗ SHYFT_API_KEY not configured');
    return {};
  }

  writeLog(`Fetching DLMM positions for ${walletAddresses.length} wallet(s) from SHYFT`);

  try {
    const positionsByWallet: Record<string, DLMMPosition[]> = {};

    for (const walletAddress of walletAddresses) {
      try {
        const query = `
          query GetPositions {
            meteora_dlmm_PositionV2(where: {owner: {_eq: "${walletAddress}"}}) {
              pubkey
              lbPair
              owner
              lowerBinId
              upperBinId
              totalClaimedFeeXAmount
              totalClaimedFeeYAmount
            }
          }
        `;

        const response = await withRetry(() =>
          fetch(SHYFT_GRAPHQL_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query,
              operationName: 'GetPositions'
            })
          })
        );

        if (!response.ok) {
          writeLog(`✗ SHYFT API failed for ${walletAddress.slice(0, 8)}...: ${response.status}`);
          positionsByWallet[walletAddress] = [];
          continue;
        }

        const result: any = await response.json();

        if (result.data?.meteora_dlmm_PositionV2) {
          const positions = result.data.meteora_dlmm_PositionV2;
          
          positionsByWallet[walletAddress] = positions.map((pos: any) => ({
            positionAddress: pos.pubkey || 'Unknown',
            lbPair: pos.lbPair || 'Unknown',
            owner: walletAddress,
            lowerBinId: parseInt(pos.lowerBinId || '0'),
            upperBinId: parseInt(pos.upperBinId || '0'),
            totalClaimedFeeXAmount: parseFloat(pos.totalClaimedFeeXAmount || '0'),
            totalClaimedFeeYAmount: parseFloat(pos.totalClaimedFeeYAmount || '0'),
            createdAt: Date.now(),
            currentValue: 0,
            inRange: true,
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

    const response = await withRetry(() =>
      fetch(`${METEORA_API_BASE}/pair/all`)
    );

    if (!response.ok) {
      writeLog(`✗ Meteora API failed: ${response.status}`);
      return { pools: [], total: 0, pages: 0 };
    }

    const data: any = await response.json();

    if (!data || !Array.isArray(data)) {
      writeLog(`✗ Unexpected API response format`);
      return { pools: [], total: 0, pages: 0 };
    }

    let pools = data
      .filter((pool: any) => pool && pool.address)
      .map((pool: any) => ({
        address: pool.address,
        name: pool.name || 'Unknown Pool',
        tokenX: pool.mint_x || '',
        tokenY: pool.mint_y || '',
        liquidity: parseFloat(pool.liquidity || '0'),
        volume24h: parseFloat(pool.trade_volume_24h || '0'),
        fees24h: parseFloat(pool.fees_24h || '0'),
        apr: parseFloat(pool.apr || '0'),
        url: `https://app.meteora.ag/dlmm/${pool.address}`,
      }))
      .sort((a: DLMMPool, b: DLMMPool) => b.liquidity - a.liquidity);

    if (search && search.trim()) {
      const searchLower = search.toLowerCase().trim();
      pools = pools.filter((pool: DLMMPool) => {
        const nameLower = pool.name.toLowerCase();
        return nameLower.includes(searchLower);
      });
    }

    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const paginatedPools = pools.slice(start, end);
    const totalPages = Math.ceil(pools.length / pageSize);

    const result = {
      pools: paginatedPools,
      total: pools.length,
      pages: totalPages,
    };

    setCache(cacheKey, result);
    writeLog(`✓ Fetched ${paginatedPools.length} pools (${pools.length} total)`);

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

  try {
    // POSITIONS
    if (type === 'positions') {
      if (!addresses || typeof addresses !== 'string') {
        return res.status(400).json({ error: 'Addresses required' });
      }

      if (!SHYFT_API_KEY) {
        return res.status(500).json({ error: 'SHYFT API key not configured' });
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