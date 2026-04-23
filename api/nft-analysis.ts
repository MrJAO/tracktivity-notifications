const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || '';
const ALCHEMY_ENDPOINT = `https://solana-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;

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
interface NFTMetadata {
  mint: string
  name: string
  symbol?: string
  image?: string
  description?: string
  collection?: {
    name?: string
    family?: string
  }
}

interface NFTDetails {
  mint: string
  name: string
  symbol?: string
  image?: string
  description?: string
  supply?: number
  holders?: number
  floorPrice?: number
  volume24h?: number
  contractAddress: string
}

// ============================================================================
// CACHE
// ============================================================================
interface CacheEntry<T> {
  data: T
  timestamp: number
}

const cache = new Map<string, CacheEntry<any>>();
const CACHE_TTL = 180000; // 3 minutes

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
// NFT FETCHING - Using Alchemy getNFTsForOwner
// ============================================================================
async function fetchNFTsForWallet(walletAddress: string): Promise<NFTMetadata[]> {
  if (!ALCHEMY_API_KEY) {
    writeLog('✗ ALCHEMY_API_KEY not configured');
    return [];
  }

  const cacheKey = `nfts:${walletAddress}`;
  const cached = getCache<NFTMetadata[]>(cacheKey);
  if (cached) {
    writeLog(`✓ Cache hit for wallet ${walletAddress.slice(0, 8)}...`);
    return cached;
  }

  writeLog(`Fetching NFTs for wallet ${walletAddress.slice(0, 8)}...`);

  try {
    const allNFTs: NFTMetadata[] = [];
    let cursor: string | undefined = undefined;
    let pageCount = 0;

    do {
      const body: any = {
        jsonrpc: '2.0',
        id: 1,
        method: 'getNFTsForOwner',
        params: {
          owner: walletAddress,
          options: {
            showCollectionMetadata: true
          }
        }
      };

      if (cursor) {
        body.params.cursor = cursor;
      }

      const response = await withRetry(() =>
        fetch(ALCHEMY_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })
      );

      if (!response.ok) {
        writeLog(`✗ Alchemy API failed: ${response.status}`);
        break;
      }

      const result: any = await response.json();

      if (result.result?.nfts) {
        const nfts = result.result.nfts.map((nft: any) => ({
          mint: nft.mint || 'Unknown',
          name: nft.name || nft.metadata?.name || 'Unnamed NFT',
          symbol: nft.symbol || nft.metadata?.symbol,
          image: nft.image?.cachedUrl || nft.image?.originalUrl || nft.metadata?.image,
          description: nft.description || nft.metadata?.description,
          collection: {
            name: nft.collection?.name,
            family: nft.collection?.family
          }
        }));

        allNFTs.push(...nfts);
        cursor = result.result.cursor;
        pageCount++;

        writeLog(`✓ Fetched page ${pageCount} - ${nfts.length} NFTs`);
        await delay(100);
      } else {
        break;
      }
    } while (cursor);

    writeLog(`✓ Total NFTs fetched: ${allNFTs.length}`);
    setCache(cacheKey, allNFTs);
    return allNFTs;
  } catch (error) {
    writeLog(`✗ Error fetching NFTs: ${error}`);
    return [];
  }
}

// ============================================================================
// NFT METADATA - Using Alchemy getNFTMetadata
// ============================================================================
async function fetchNFTMetadata(mint: string): Promise<NFTDetails | null> {
  if (!ALCHEMY_API_KEY) {
    writeLog('✗ ALCHEMY_API_KEY not configured');
    return null;
  }

  const cacheKey = `nft_details:${mint}`;
  const cached = getCache<NFTDetails>(cacheKey);
  if (cached) {
    writeLog(`✓ Cache hit for NFT ${mint.slice(0, 8)}...`);
    return cached;
  }

  writeLog(`Fetching metadata for NFT ${mint.slice(0, 8)}...`);

  try {
    const response = await withRetry(() =>
      fetch(ALCHEMY_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getNFTMetadata',
          params: {
            mint: mint,
            options: {
              showCollectionMetadata: true
            }
          }
        })
      })
    );

    if (!response.ok) {
      writeLog(`✗ Alchemy API failed: ${response.status}`);
      return null;
    }

    const result: any = await response.json();

    if (result.result) {
      const nft = result.result;
      const details: NFTDetails = {
        mint: mint,
        name: nft.name || nft.metadata?.name || 'Unnamed NFT',
        symbol: nft.symbol || nft.metadata?.symbol,
        image: nft.image?.cachedUrl || nft.image?.originalUrl || nft.metadata?.image,
        description: nft.description || nft.metadata?.description,
        supply: nft.supply || null,
        holders: nft.holders || null,
        floorPrice: nft.floorPrice || null,
        volume24h: nft.volume24h || null,
        contractAddress: mint
      };

      setCache(cacheKey, details);
      writeLog(`✓ Fetched metadata for ${nft.name}`);
      return details;
    }

    return null;
  } catch (error) {
    writeLog(`✗ Error fetching NFT metadata: ${error}`);
    return null;
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

  const { type, wallet, mint } = req.query;

  try {
    // FETCH NFTs FOR WALLET
    if (type === 'nfts' && wallet) {
      if (typeof wallet !== 'string') {
        return res.status(400).json({ error: 'Invalid wallet address' });
      }

      const nfts = await fetchNFTsForWallet(wallet);
      return res.status(200).json({ nfts });
    }

    // FETCH NFT METADATA
    if (type === 'metadata' && mint) {
      if (typeof mint !== 'string') {
        return res.status(400).json({ error: 'Invalid mint address' });
      }

      const metadata = await fetchNFTMetadata(mint);
      
      if (!metadata) {
        return res.status(404).json({ error: 'NFT not found' });
      }

      return res.status(200).json({ metadata });
    }

    return res.status(400).json({ error: 'Invalid type parameter. Use: nfts or metadata' });
  } catch (error) {
    writeLog(`✗ Handler error: ${error}`);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: String(error)
    });
  }
}