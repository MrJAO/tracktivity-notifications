// ============================================================================
// CONSTANTS
// ============================================================================
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

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
export interface DAppMetadata {
  mint: string;
  name: string;
  image: string;
  about: string;
  version: string;
  lastUpdated: string;
  updateInfo: string;
  totalReviews: number;
  nftTokenAddress: string;
  mintedDate: string;
  devAddress: string;
}

// ============================================================================
// CACHE
// ============================================================================
interface CacheEntry<T> {
  data: T;
  timestamp: number;
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
// HELPER FUNCTIONS
// ============================================================================
async function fetchNFTMetadata(mint: string): Promise<DAppMetadata | null> {
  if (!HELIUS_API_KEY) {
    writeLog('✗ HELIUS_API_KEY not configured');
    return null;
  }

  const cacheKey = `dapp_meta:${mint}`;
  const cached = getCache<DAppMetadata>(cacheKey);
  if (cached) {
    writeLog(`✓ Cache hit for dApp metadata ${mint.slice(0, 8)}...`);
    return cached;
  }

  writeLog(`Fetching dApp metadata for ${mint.slice(0, 8)}...`);

  try {
    const response = await withRetry(() =>
      fetch(HELIUS_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'dapp-store-metadata',
          method: 'getAsset',
          params: { id: mint },
        }),
      })
    );

    const data = await response.json();
    
    if (!data.result) {
      writeLog(`✗ No metadata found for ${mint.slice(0, 8)}...`);
      return null;
    }

    const asset = data.result;
    
    // Parse metadata from Metaplex standard
    const metadata = asset.content?.metadata || {};
    const attributes = metadata.attributes || [];
    
    // Extract custom attributes
    const getAttr = (name: string) => 
      attributes.find((a: any) => a.trait_type === name)?.value || '';

    const dappMetadata: DAppMetadata = {
      mint: asset.id,
      name: metadata.name || 'Unknown dApp',
      image: asset.content?.links?.image || '',
      about: metadata.description || '',
      version: getAttr('Version') || '1.0.0',
      lastUpdated: getAttr('Last Updated') || new Date().toISOString(),
      updateInfo: getAttr('Update Info') || 'No recent updates',
      totalReviews: parseInt(getAttr('Total Reviews') || '0', 10),
      nftTokenAddress: asset.id,
      mintedDate: asset.minting_info?.time || new Date().toISOString(),
      devAddress: asset.ownership?.owner || '',
    };

    setCache(cacheKey, dappMetadata);
    writeLog(`✓ Fetched metadata for ${metadata.name}`);

    return dappMetadata;
  } catch (error) {
    writeLog(`✗ Error fetching NFT metadata: ${error}`);
    return null;
  }
}

async function fetchDAppsByWallet(walletAddress: string): Promise<DAppMetadata[]> {
  if (!HELIUS_API_KEY) {
    writeLog('✗ HELIUS_API_KEY not configured');
    return [];
  }

  const cacheKey = `dapps_wallet:${walletAddress}`;
  const cached = getCache<DAppMetadata[]>(cacheKey);
  if (cached) {
    writeLog(`✓ Cache hit for wallet dApps ${walletAddress.slice(0, 8)}...`);
    return cached;
  }

  writeLog(`Fetching dApps for wallet ${walletAddress.slice(0, 8)}...`);

  try {
    const response = await withRetry(() =>
      fetch(HELIUS_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'dapp-store-wallet',
          method: 'getAssetsByOwner',
          params: {
            ownerAddress: walletAddress,
            page: 1,
            limit: 1000,
          },
        }),
      })
    );

    const data = await response.json();
    
    if (!data.result || !data.result.items) {
      writeLog(`✗ No assets found for wallet ${walletAddress.slice(0, 8)}...`);
      return [];
    }

    // Filter for dApp Store NFTs
    const dAppNFTs: DAppMetadata[] = [];
    
    for (const asset of data.result.items) {
      const metadata = asset.content?.metadata || {};
      const attributes = metadata.attributes || [];
      
      // Check if this is a dApp Store NFT (customize this logic)
      const isDAppStore = attributes.some((a: any) => 
        a.trait_type === 'Type' && a.value === 'dApp Store'
      );
      
      if (isDAppStore) {
        const getAttr = (name: string) => 
          attributes.find((a: any) => a.trait_type === name)?.value || '';

        dAppNFTs.push({
          mint: asset.id,
          name: metadata.name || 'Unknown dApp',
          image: asset.content?.links?.image || '',
          about: metadata.description || '',
          version: getAttr('Version') || '1.0.0',
          lastUpdated: getAttr('Last Updated') || new Date().toISOString(),
          updateInfo: getAttr('Update Info') || 'No recent updates',
          totalReviews: parseInt(getAttr('Total Reviews') || '0', 10),
          nftTokenAddress: asset.id,
          mintedDate: asset.minting_info?.time || new Date().toISOString(),
          devAddress: asset.ownership?.owner || '',
        });

        await delay(50);
      }
    }

    setCache(cacheKey, dAppNFTs);
    writeLog(`✓ Found ${dAppNFTs.length} dApp Store NFTs for ${walletAddress.slice(0, 8)}...`);

    return dAppNFTs;
  } catch (error) {
    writeLog(`✗ Error fetching dApps by wallet: ${error}`);
    return [];
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

  const { type, mint, wallet } = req.query;

  try {
    if (type === 'metadata' && mint) {
      const metadata = await fetchNFTMetadata(mint as string);
      return res.status(200).json({ metadata });
    }

    if (type === 'wallet' && wallet) {
      const dapps = await fetchDAppsByWallet(wallet as string);
      return res.status(200).json({ dapps });
    }

    return res.status(400).json({ error: 'Invalid request parameters' });
  } catch (error) {
    writeLog(`✗ Handler error: ${error}`);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: String(error)
    });
  }
}