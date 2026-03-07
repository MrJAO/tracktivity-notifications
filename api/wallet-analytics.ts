import fetch from 'node-fetch';

// ============================================================================
// TYPES
// ============================================================================

interface TransactionData {
  date: string;
  count: number;
}

interface ActivityStats {
  totalVolume: number;
  totalTransactions: number;
  swaps: number;
  transfers: number;
  other: number;
  dailyTransactions: TransactionData[];
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const HELIUS_API = `https://api.helius.xyz/v0`;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function writeLog(message: string): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

// ============================================================================
// WALLET ANALYTICS FETCHER
// ============================================================================

async function fetchWalletAnalytics(address: string): Promise<ActivityStats> {
  try {
    writeLog(`Fetching analytics for: ${address}`);

    // Fetch parsed transactions from Helius
    const response = await fetch(
      `${HELIUS_API}/addresses/${address}/transactions?api-key=${HELIUS_API_KEY}&limit=100`,
      {
        headers: {
          'Accept': 'application/json',
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Helius API error: ${response.status}`);
    }

    const transactions: any[] = await response.json();

    writeLog(`✓ Fetched ${transactions.length} transactions`);

    // Get last 30 days timestamp
    const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);

    // Filter recent transactions
    const recentTxs = transactions.filter((tx: any) => 
      tx.timestamp && tx.timestamp >= thirtyDaysAgo
    );

    writeLog(`✓ Found ${recentTxs.length} transactions in last 30 days`);

    let totalVolume = 0;
    let swaps = 0;
    let transfers = 0;
    let other = 0;
    const dailyMap: Record<string, number> = {};

    // Process each transaction
    recentTxs.forEach((tx: any) => {
      if (!tx.timestamp) return;

      // Get date
      const date = new Date(tx.timestamp * 1000);
      const dateKey = date.toISOString().split('T')[0];
      
      // Count daily transactions
      dailyMap[dateKey] = (dailyMap[dateKey] || 0) + 1;

      // Categorize transaction type
      const txType = (tx.type || '').toUpperCase();
      
      if (txType.includes('SWAP')) {
        swaps++;
      } else if (txType.includes('TRANSFER') || txType.includes('SPL_TRANSFER')) {
        transfers++;
      } else {
        other++;
      }

      // Calculate volume from native transfers
      if (tx.nativeTransfers && tx.nativeTransfers.length > 0) {
        tx.nativeTransfers.forEach((transfer: any) => {
          if (transfer.fromUserAccount === address) {
            totalVolume += Math.abs(transfer.amount) / 1e9; // Convert lamports to SOL
          }
        });
      }
    });

    // Convert daily map to array
    const dailyTransactions: TransactionData[] = Object.entries(dailyMap)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const stats: ActivityStats = {
      totalVolume,
      totalTransactions: recentTxs.length,
      swaps,
      transfers,
      other,
      dailyTransactions,
    };

    writeLog(`✓ Analytics complete - Txs: ${stats.totalTransactions}, Swaps: ${swaps}, Transfers: ${transfers}`);
    
    return stats;

  } catch (error) {
    writeLog(`✗ Error fetching analytics: ${error}`);
    throw error;
  }
}

// ============================================================================
// VERCEL SERVERLESS HANDLER
// ============================================================================

export default async function handler(req: any, res: any) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { address } = req.query;

  // Validate address parameter
  if (!address || typeof address !== 'string') {
    return res.status(400).json({ 
      error: 'Wallet address required',
      totalVolume: 0,
      totalTransactions: 0,
      swaps: 0,
      transfers: 0,
      other: 0,
      dailyTransactions: []
    });
  }

  // Validate Helius API key
  if (!HELIUS_API_KEY) {
    writeLog('⚠ HELIUS_API_KEY not configured');
    return res.status(500).json({ 
      error: 'Server configuration error',
      totalVolume: 0,
      totalTransactions: 0,
      swaps: 0,
      transfers: 0,
      other: 0,
      dailyTransactions: []
    });
  }

  try {
    writeLog('════════════════════════════════════════════════════════════');
    writeLog(`Wallet Analytics Request: ${address.substring(0, 8)}...`);
    writeLog('════════════════════════════════════════════════════════════');

    const stats = await fetchWalletAnalytics(address);

    writeLog('════════════════════════════════════════════════════════════');
    writeLog('✓ Analytics request completed successfully');
    writeLog('════════════════════════════════════════════════════════════');

    return res.status(200).json(stats);

  } catch (error) {
    writeLog(`✗ Request failed: ${error}`);
    
    return res.status(500).json({ 
      error: 'Failed to fetch analytics',
      details: String(error),
      totalVolume: 0,
      totalTransactions: 0,
      swaps: 0,
      transfers: 0,
      other: 0,
      dailyTransactions: []
    });
  }
}