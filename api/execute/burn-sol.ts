import fetch from 'node-fetch';

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const RPC_ENDPOINT = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

// Safe mints
const SAFE_MINTS = [
  'So11111111111111111111111111111111111111112', // Wrapped SOL
  'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3', // SKR Token Mint
  'GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4', // Seeker Genesis Token Mint Authority
  'GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te', // Seeker Genesis Token Metadata
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
];

interface BurnableAsset {
  address: string
  mint: string
  amount: number
  decimals: number
  type: 'token' | 'nft' | 'cnft'
  name: string
  symbol: string
  image?: string
  rentLamports: number
}

interface BurnResponse {
  burnableAssets: BurnableAsset[]
  totalReclaimable: number
  totalAssets: number
}

function writeLog(message: string): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

async function fetchTokenMetadata(mint: string): Promise<{ name: string; symbol: string }> {
  try {
    const response = await fetch(RPC_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'metadata',
        method: 'getAsset',
        params: { id: mint },
      }),
    });

    if (response.ok) {
      const json = await response.json() as any;
      const content = json?.result?.content;
      
      if (content?.metadata) {
        return {
          name: content.metadata.name || `${mint.slice(0, 4)}...${mint.slice(-4)}`,
          symbol: content.metadata.symbol || `${mint.slice(0, 4)}...${mint.slice(-4)}`,
        };
      }
    }
  } catch (error) {
    // Silent fallback
  }
  
  return {
    name: `${mint.slice(0, 4)}...${mint.slice(-4)}`,
    symbol: `${mint.slice(0, 4)}...${mint.slice(-4)}`,
  };
}

async function fetchTokens(walletAddress: string): Promise<BurnableAsset[]> {
  try {
    writeLog('Fetching SPL tokens...');
    
    const response = await fetch(RPC_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTokenAccountsByOwner',
        params: [
          walletAddress,
          { programId: TOKEN_PROGRAM_ID },
          { encoding: 'jsonParsed' },
        ],
      }),
    });

    if (!response.ok) {
      writeLog(`✗ Token fetch failed: ${response.status}`);
      return [];
    }

    const json = await response.json() as any;
    const accounts = json?.result?.value || [];
    writeLog(`✓ Found ${accounts.length} token accounts`);

    const tokens: BurnableAsset[] = [];

    for (const account of accounts) {
      try {
        const accountPubkey = account.pubkey;
        const accountData = account.account.data.parsed.info;
        const mint = accountData.mint;
        const balance = accountData.tokenAmount.uiAmount;
        const decimals = accountData.tokenAmount.decimals;
        const rentLamports = account.account.lamports;

        // Filter: must have balance > 0, not in safe list
        if (balance > 0 && !SAFE_MINTS.includes(mint) && rentLamports > 0) {
          const metadata = await fetchTokenMetadata(mint);
          
          tokens.push({
            address: accountPubkey,
            mint: mint,
            amount: balance,
            decimals: decimals,
            type: 'token',
            name: metadata.name,
            symbol: metadata.symbol,
            rentLamports: rentLamports,
          });
          writeLog(`✓ Added token: ${metadata.symbol} (${balance})`);
        }
      } catch (error) {
        writeLog(`✗ Error processing token: ${error}`);
        continue;
      }
    }

    return tokens;
  } catch (error) {
    writeLog(`✗ Error fetching tokens: ${error}`);
    return [];
  }
}

async function fetchNFTsAndCNFTs(walletAddress: string): Promise<BurnableAsset[]> {
  try {
    writeLog('Fetching NFTs and cNFTs...');
    
    const response = await fetch(RPC_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'nft-scan',
        method: 'getAssetsByOwner',
        params: {
          ownerAddress: walletAddress,
          page: 1,
          limit: 1000,
          displayOptions: {
            showFungible: false,
            showNativeBalance: false,
          },
        },
      }),
    });

    if (!response.ok) {
      writeLog(`✗ NFT fetch failed: ${response.status}`);
      return [];
    }

    const json = await response.json() as any;
    const items = json?.result?.items || [];
    writeLog(`✓ Found ${items.length} NFTs/cNFTs`);

    const nfts: BurnableAsset[] = [];

    for (const item of items) {
      try {
        const id = item.id;
        const content = item.content;
        const compression = item.compression;

        // Skip if in safe list
        if (SAFE_MINTS.includes(id)) {
          continue;
        }

        // Determine if NFT or cNFT
        const assetType: 'nft' | 'cnft' = compression?.compressed ? 'cnft' : 'nft';

        const name = content?.metadata?.name || `${id.slice(0, 4)}...${id.slice(-4)}`;
        const symbol = content?.metadata?.symbol || 'NFT';
        const image = content?.files?.[0]?.uri || content?.links?.image;

        // Estimate rent
        const rentLamports = 2039280;

        nfts.push({
          address: id,
          mint: id,
          amount: 1,
          decimals: 0,
          type: assetType,
          name: name,
          symbol: symbol,
          image: image,
          rentLamports: rentLamports,
        });

        writeLog(`✓ Added ${assetType}: ${name}`);
      } catch (error) {
        writeLog(`✗ Error processing NFT: ${error}`);
        continue;
      }
    }

    return nfts;
  } catch (error) {
    writeLog(`✗ Error fetching NFTs: ${error}`);
    return [];
  }
}

async function scanBurnableAssets(walletAddress: string): Promise<BurnResponse> {
  try {
    writeLog(`Scanning burnable assets for: ${walletAddress}`);

    // Fetch both tokens and NFTs in parallel
    const [tokens, nfts] = await Promise.all([
      fetchTokens(walletAddress),
      fetchNFTsAndCNFTs(walletAddress),
    ]);

    const burnableAssets = [...tokens, ...nfts];

    const totalReclaimable = burnableAssets.reduce(
      (sum, acc) => sum + acc.rentLamports,
      0
    );

    const totalReclaimableSOL = totalReclaimable / 1e9;

    writeLog(`✓ Total: ${tokens.length} tokens + ${nfts.length} NFTs/cNFTs = ${burnableAssets.length} burnable assets`);
    writeLog(`✓ Total reclaimable: ${totalReclaimableSOL.toFixed(6)} SOL`);

    return {
      burnableAssets,
      totalReclaimable: totalReclaimableSOL,
      totalAssets: burnableAssets.length,
    };
  } catch (error) {
    writeLog(`✗ Error scanning assets: ${error}`);
    return { burnableAssets: [], totalReclaimable: 0, totalAssets: 0 };
  }
}

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

  const { address } = req.query;

  if (!address || typeof address !== 'string') {
    return res.status(400).json({
      error: 'Wallet address required',
      burnableAssets: [],
      totalReclaimable: 0,
      totalAssets: 0,
    });
  }

  if (!HELIUS_API_KEY) {
    return res.status(500).json({
      error: 'Server configuration error',
      burnableAssets: [],
      totalReclaimable: 0,
      totalAssets: 0,
    });
  }

  try {
    const result = await scanBurnableAssets(address);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to scan burnable assets',
      details: String(error),
      burnableAssets: [],
      totalReclaimable: 0,
      totalAssets: 0,
    });
  }
}