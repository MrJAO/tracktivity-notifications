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
const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

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

    // Calculate 30 days ago timestamp
    const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);

    let allTransactions: any[] = [];
    let paginationToken: string | undefined = undefined;
    let callCount = 0;
    const MAX_CALLS = 5; // Prevent infinite loops

    // Paginate through all transactions
    while (callCount < MAX_CALLS) {
      callCount++;
      
      const requestBody: any = {
        jsonrpc: '2.0',
        id: `analytics-${callCount}`,
        method: 'getSignaturesForAddress',
        params: [
          address,
          {
            limit: 1000,
          }
        ]
      };

      // Add pagination token if exists
      if (paginationToken) {
        requestBody.params[1].before = paginationToken;
      }

      writeLog(`Making RPC call ${callCount} with limit 1000${paginationToken ? ' (paginating)' : ''}`);

      const response = await fetch(HELIUS_RPC, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`Helius RPC error: ${response.status}`);
      }

      const result: any = await response.json();
      const signatures = result.result || [];

      writeLog(`✓ Fetched ${signatures.length} signatures in call ${callCount}`);

      if (signatures.length === 0) {
        break; // No more transactions
      }

      // Filter by 30 days
      const recentSigs = signatures.filter((sig: any) => 
        sig.blockTime && sig.blockTime >= thirtyDaysAgo
      );

      allTransactions.push(...recentSigs);

      // Check if we got transactions older than 30 days
      const oldestTimestamp = signatures[signatures.length - 1]?.blockTime;
      if (oldestTimestamp && oldestTimestamp < thirtyDaysAgo) {
        writeLog(`✓ Reached transactions older than 30 days`);
        break;
      }

      // Check if we need to paginate
      if (signatures.length < 1000) {
        writeLog(`✓ Fetched all available transactions`);
        break;
      }

      // Set pagination token for next call
      paginationToken = signatures[signatures.length - 1].signature;
    }

    writeLog(`✓ Total signatures fetched: ${allTransactions.length} from ${callCount} API calls`);

    // Build daily transaction map
    const dailyMap: Record<string, number> = {};
    
    allTransactions.forEach((sig: any) => {
      if (!sig.blockTime) return;

      const date = new Date(sig.blockTime * 1000);
      const dateKey = date.toISOString().split('T')[0];
      
      dailyMap[dateKey] = (dailyMap[dateKey] || 0) + 1;
    });

    // Convert daily map to array
    const dailyTransactions: TransactionData[] = Object.entries(dailyMap)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const stats: ActivityStats = {
      totalVolume: 0, // Removed to save API credits
      totalTransactions: allTransactions.length,
      swaps: 0, // Removed to save API credits
      transfers: 0, // Removed to save API credits
      other: 0, // Removed to save API credits
      dailyTransactions,
    };

    writeLog(`✓ Analytics complete - Txs: ${stats.totalTransactions}`);
    
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