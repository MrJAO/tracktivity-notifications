// tracktivity-notifications/api/execute/burn-sol.ts

import fetch from 'node-fetch';

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const RPC_ENDPOINT = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

// Safe addresses - DO NOT burn these
const SAFE_MINTS = [
  'So11111111111111111111111111111111111111112', // Wrapped SOL
  'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3', // SKR Token Mint
  'GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4', // Seeker Genesis Token Mint Authority
  'GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te', // Seeker Genesis Token Metadata
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

async function fetchAssetMetadata(mint: string): Promise<{ name: string; symbol: string; image?: string; type: 'token' | 'nft' | 'cnft' }> {
  try {
    const response = await fetch(RPC_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAsset',
        params: { id: mint },
      }),
    });

    const json = await response.json() as any;
    const content = json?.result?.content;
    const grouping = json?.result?.grouping;

    // Determine asset type
    let assetType: 'token' | 'nft' | 'cnft' = 'token';
    
    // Check if it's a compressed NFT
    if (json?.result?.compression?.compressed) {
      assetType = 'cnft';
    }
    // Check if it's an NFT (has collection or is non-fungible)
    else if (grouping?.length > 0 || json?.result?.interface === 'V1_NFT') {
      assetType = 'nft';
    }

    if (content?.metadata) {
      return {
        name: content.metadata.name || 'Unknown Asset',
        symbol: content.metadata.symbol || 'UNKNOWN',
        image: content.files?.[0]?.uri || content.links?.image,
        type: assetType,
      };
    }

    return { name: 'Unknown Asset', symbol: 'UNKNOWN', type: assetType };
  } catch (error) {
    return { name: 'Unknown Asset', symbol: 'UNKNOWN', type: 'token' };
  }
}

async function scanBurnableAssets(walletAddress: string): Promise<BurnResponse> {
  try {
    writeLog(`Scanning burnable assets for: ${walletAddress}`);

    // Fetch all token accounts owned by wallet
    const response = await fetch(RPC_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getParsedTokenAccountsByOwner',
        params: [
          walletAddress,
          { programId: TOKEN_PROGRAM_ID },
          { encoding: 'jsonParsed' },
        ],
      }),
    });

    if (!response.ok) {
      writeLog(`✗ RPC request failed: ${response.status}`);
      return { burnableAssets: [], totalReclaimable: 0, totalAssets: 0 };
    }

    const json = await response.json() as any;
    const accounts = json?.result?.value || [];
    writeLog(`✓ Found ${accounts.length} token accounts`);

    const burnableAssets: BurnableAsset[] = [];

    for (const account of accounts) {
      try {
        const accountData = account.account.data.parsed.info;
        const mint = accountData.mint;
        const balance = accountData.tokenAmount.uiAmount;
        const decimals = accountData.tokenAmount.decimals;
        const rentLamports = account.account.lamports;

        // Filter: must have balance > 0, not in safe list, and has rent
        if (
          balance > 0 &&
          !SAFE_MINTS.includes(mint) &&
          rentLamports > 0
        ) {
          // Fetch asset metadata
          const metadata = await fetchAssetMetadata(mint);

          burnableAssets.push({
            address: account.pubkey,
            mint: mint,
            amount: balance,
            decimals: decimals,
            type: metadata.type,
            name: metadata.name,
            symbol: metadata.symbol,
            image: metadata.image,
            rentLamports: rentLamports,
          });
        }
      } catch (error) {
        writeLog(`✗ Error processing account: ${error}`);
        continue;
      }
    }

    const totalReclaimable = burnableAssets.reduce(
      (sum, acc) => sum + acc.rentLamports,
      0
    );

    const totalReclaimableSOL = totalReclaimable / 1e9;

    writeLog(`✓ Found ${burnableAssets.length} burnable assets`);
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