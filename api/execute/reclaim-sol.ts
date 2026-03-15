// tracktivity-notifications/api/execute/reclaim-sol.ts

import fetch from 'node-fetch';

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const RPC_ENDPOINT = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

// Safe addresses - DO NOT close these
const SAFE_ADDRESSES = [
  'So11111111111111111111111111111111111111112', // Wrapped SOL
  'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3', // SKR Token Mint
  'GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4', // Seeker Genesis Token Mint Authority
  'GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te', // Seeker Genesis Token Metadata
  '8isViKbwhuhFhsv2t8vaFL74pKCqaFPQXo1KkeQwZbB8', // Seeker Staking Vault
  '4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw', // Seeker Global Staking Config
  'SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ', // Solana Seeker TX Program
];

interface TokenMetadata {
  symbol: string;
  name: string;
}

interface ReclaimableAccount {
  address: string;
  mint: string;
  rentLamports: number;
  tokenSymbol: string;
  tokenName: string;
}

interface ReclaimResponse {
  reclaimableAccounts: ReclaimableAccount[];
  totalReclaimable: number;
  totalAccounts: number;
}

function writeLog(message: string): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

async function fetchTokenMetadata(mint: string): Promise<TokenMetadata> {
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

    if (content?.metadata) {
      return {
        symbol: content.metadata.symbol || 'UNKNOWN',
        name: content.metadata.name || 'Unknown Token',
      };
    }

    return { symbol: 'UNKNOWN', name: 'Unknown Token' };
  } catch (error) {
    return { symbol: 'UNKNOWN', name: 'Unknown Token' };
  }
}

async function scanReclaimableAccounts(walletAddress: string): Promise<ReclaimResponse> {
  try {
    writeLog(`Scanning reclaimable accounts for: ${walletAddress}`);

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
      return { reclaimableAccounts: [], totalReclaimable: 0, totalAccounts: 0 };
    }

    const json = await response.json() as any;
    const accounts = json?.result?.value || [];
    writeLog(`✓ Found ${accounts.length} token accounts`);

    const reclaimableAccounts: ReclaimableAccount[] = [];

    for (const account of accounts) {
      try {
        const accountData = account.account.data.parsed.info;
        const mint = accountData.mint;
        const balance = accountData.tokenAmount.uiAmount;
        const rentLamports = account.account.lamports;

        // Filter: balance must be 0, not in safe addresses, and has rent
        if (
          balance === 0 &&
          !SAFE_ADDRESSES.includes(mint) &&
          rentLamports > 0
        ) {
          // Fetch token metadata
          const metadata = await fetchTokenMetadata(mint);

          reclaimableAccounts.push({
            address: account.pubkey,
            mint: mint,
            rentLamports: rentLamports,
            tokenSymbol: metadata.symbol,
            tokenName: metadata.name,
          });
        }
      } catch (error) {
        writeLog(`✗ Error processing account: ${error}`);
        continue;
      }
    }

    const totalReclaimable = reclaimableAccounts.reduce(
      (sum, acc) => sum + acc.rentLamports,
      0
    );

    const totalReclaimableSOL = totalReclaimable / 1e9;

    writeLog(`✓ Found ${reclaimableAccounts.length} reclaimable accounts`);
    writeLog(`✓ Total reclaimable: ${totalReclaimableSOL.toFixed(6)} SOL`);

    return {
      reclaimableAccounts,
      totalReclaimable: totalReclaimableSOL,
      totalAccounts: reclaimableAccounts.length,
    };
  } catch (error) {
    writeLog(`✗ Error scanning accounts: ${error}`);
    return { reclaimableAccounts: [], totalReclaimable: 0, totalAccounts: 0 };
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
      reclaimableAccounts: [],
      totalReclaimable: 0,
      totalAccounts: 0,
    });
  }

  if (!HELIUS_API_KEY) {
    return res.status(500).json({
      error: 'Server configuration error',
      reclaimableAccounts: [],
      totalReclaimable: 0,
      totalAccounts: 0,
    });
  }

  try {
    const result = await scanReclaimableAccounts(address);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to scan reclaimable accounts',
      details: String(error),
      reclaimableAccounts: [],
      totalReclaimable: 0,
      totalAccounts: 0,
    });
  }
}