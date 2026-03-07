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

const SOLSCAN_API_KEY = process.env.SOLSCAN_API_KEY || '';
const SOLSCAN_API = 'https://pro-api.solscan.io/v2.0';

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

    // Fetch account transactions from Solscan Pro API
    const response = await fetch(
      `${SOLSCAN_API}/account/transaction?address=${address}&page_size=100&page=1`,
      {
        headers: {
          'Accept': 'application/json',
          'token': SOLSCAN_API_KEY,
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Solscan API error: ${response.status}`);
    }

    const result: any = await response.json();
    const transactions = result.data || [];

    writeLog(`✓ Fetched ${transactions.length} transactions`);

    // Get last 30 days timestamp
    const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);

    // Filter recent transactions
    const recentTxs = transactions.filter((tx: any) => 
      tx.block_time && tx.block_time >= thirtyDaysAgo
    );

    writeLog(`✓ Found ${recentTxs.length} transactions in last 30 days`);

    let totalVolume = 0;
    let swaps = 0;
    let transfers = 0;
    let other = 0;
    const dailyMap: Record<string, number> = {};

    // Process each transaction
    recentTxs.forEach((tx: any) => {
      if (!tx.block_time) return;

      // Get date
      const date = new Date(tx.block_time * 1000);
      const dateKey = date.toISOString().split('T')[0];
      
      // Count daily transactions
      dailyMap[dateKey] = (dailyMap[dateKey] || 0) + 1;

      // Categorize transaction type
      const txType = (tx.tx_type || '').toLowerCase();
      const activities = tx.activities || [];

      if (txType.includes('swap') || activities.some((a: any) => a.activity_type?.includes('ACTIVITY_TOKEN_SWAP'))) {
        swaps++;
      } else if (txType.includes('transfer') || activities.some((a: any) => a.activity_type?.includes('ACTIVITY_SPL_TRANSFER'))) {
        transfers++;
      } else {
        other++;
      }

      // Calculate volume from SOL transfers
      if (tx.sol_amount) {
        totalVolume += Math.abs(tx.sol_amount) / 1e9; // Convert lamports to SOL
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

  // Validate Solscan API key
  if (!SOLSCAN_API_KEY) {
    writeLog('⚠ SOLSCAN_API_KEY not configured');
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