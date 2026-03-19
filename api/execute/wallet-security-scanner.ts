import fetch from 'node-fetch';

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const RPC_ENDPOINT = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

// Safe mints - excluded from scanning
const SAFE_MINTS = [
  'So11111111111111111111111111111111111111112', // Wrapped SOL
  'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3', // SKR
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
];

interface TokenPermission {
  address: string
  mint: string
  delegate: string | null
  delegatedAmount: number
  decimals: number
  tokenSymbol: string
  tokenName: string
  authority: string
  riskLevel: 'safe' | 'low' | 'medium' | 'high' | 'critical'
  riskReason: string
  isDormant: boolean
  lastActivity?: number
}

interface SecurityScanResult {
  permissions: TokenPermission[]
  securityScore: number
  scoreStatus: 'safe' | 'moderate' | 'high-risk' | 'critical'
  totalPermissions: number
  activePermissions: number
  dormantPermissions: number
  criticalIssues: number
  recommendations: string[]
  scanStats: {
    totalAccounts: number
    scannedAccounts: Array<{
      mint: string
      symbol: string
      balance: string
      isSecure: boolean
      isSafeMint: boolean
      statusMessage: string
    }>
  }
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
    writeLog(`[Metadata] Failed to fetch for ${mint}: ${error}`)
  }
  
  return {
    name: `${mint.slice(0, 4)}...${mint.slice(-4)}`,
    symbol: `${mint.slice(0, 4)}...${mint.slice(-4)}`,
  };
}

function analyzeRisk(
  delegate: string | null,
  delegatedAmount: number,
  decimals: number,
  authority: string,
  walletAddress: string,
  balance: number
): { level: 'safe' | 'low' | 'medium' | 'high' | 'critical'; reason: string } {
  writeLog(`[Risk Analysis] Delegate: ${delegate}, Amount: ${delegatedAmount}, Authority: ${authority}, Balance: ${balance}`)
  
  // No delegate = safe
  if (!delegate) {
    writeLog('[Risk Analysis] → No delegate = SAFE')
    return { level: 'safe', reason: 'No active permissions' };
  }

  const maxU64 = BigInt('18446744073709551615');
  const delegatedRaw = BigInt(Math.floor(delegatedAmount * Math.pow(10, decimals)));
  writeLog(`[Risk Analysis] Delegated raw: ${delegatedRaw.toString()}, Max U64: ${maxU64.toString()}`)

  // Authority changed (not wallet owner)
  if (authority !== walletAddress) {
    writeLog('[Risk Analysis] → Authority changed = CRITICAL')
    return {
      level: 'critical',
      reason: 'Authority changed - someone else controls this token!',
    };
  }

  // Unlimited approval
  if (delegatedRaw >= maxU64 / BigInt(2)) {
    writeLog('[Risk Analysis] → Unlimited approval = HIGH')
    return {
      level: 'high',
      reason: 'Unlimited approval granted',
    };
  }

  // Large delegation (>50% of balance)
  if (balance > 0 && delegatedAmount > balance * 0.5) {
    writeLog('[Risk Analysis] → Large delegation = MEDIUM')
    return {
      level: 'medium',
      reason: `Large approval: ${delegatedAmount.toFixed(2)} tokens`,
    };
  }

  // Active delegate but reasonable amount
  writeLog('[Risk Analysis] → Active but reasonable = LOW')
  return {
    level: 'low',
    reason: `Active approval: ${delegatedAmount.toFixed(2)} tokens`,
  };
}

function calculateSecurityScore(permissions: TokenPermission[]): {
  score: number
  status: 'safe' | 'moderate' | 'high-risk' | 'critical'
  criticalCount: number
  recommendations: string[]
} {
  writeLog(`[Score Calculation] Processing ${permissions.length} permissions`)
  
  let score = 100;
  let criticalCount = 0;
  const recommendations: string[] = [];

  for (const p of permissions) {
    writeLog(`[Score] Permission: ${p.tokenSymbol} | Risk: ${p.riskLevel} | Dormant: ${p.isDormant}`)
    
    if (p.riskLevel === 'critical') {
      score -= 40;
      criticalCount++;
      recommendations.push(`Revoke critical permission on ${p.tokenSymbol}`);
      writeLog(`[Score] → -40 points (critical)`)
    } else if (p.riskLevel === 'high') {
      score -= 25;
      criticalCount++;
      recommendations.push(`Revoke unlimited approval on ${p.tokenSymbol}`);
      writeLog(`[Score] → -25 points (high)`)
    } else if (p.riskLevel === 'medium') {
      score -= 10;
      writeLog(`[Score] → -10 points (medium)`)
    } else if (p.riskLevel === 'low') {
      score -= 5;
      writeLog(`[Score] → -5 points (low)`)
    }

    if (p.isDormant && p.delegate) {
      score -= 3;
      writeLog(`[Score] → -3 points (dormant)`)
    }
  }

  score = Math.max(0, Math.min(100, score));

  let status: 'safe' | 'moderate' | 'high-risk' | 'critical';
  if (score >= 90) status = 'safe';
  else if (score >= 70) status = 'moderate';
  else if (score >= 40) status = 'high-risk';
  else status = 'critical';

  if (recommendations.length === 0) {
    recommendations.push('Your wallet security looks good!');
  }

  writeLog(`[Score Calculation] Final score: ${score} | Status: ${status} | Critical: ${criticalCount}`)

  return { score, status, criticalCount, recommendations };
}

async function scanWalletSecurity(walletAddress: string): Promise<SecurityScanResult> {
  try {
    writeLog(`[Scan Start] Wallet: ${walletAddress}`);

    // Fetch token accounts
    writeLog('[RPC] Fetching token accounts...')
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

    writeLog(`[RPC] Response status: ${response.status}`)

    if (!response.ok) {
      writeLog(`[RPC] ✗ Token fetch failed: ${response.status}`);
      return {
        permissions: [],
        securityScore: 100,
        scoreStatus: 'safe',
        totalPermissions: 0,
        activePermissions: 0,
        dormantPermissions: 0,
        criticalIssues: 0,
        recommendations: ['Scan failed - please try again'],
        scanStats: {
          totalAccounts: 0,
          scannedAccounts: [],
        },
      };
    }

    const json = await response.json() as any;
    const accounts = json?.result?.value || [];
    writeLog(`[RPC] ✓ Found ${accounts.length} token accounts`);

    const permissions: TokenPermission[] = [];
    const scannedAccounts: Array<{
      mint: string
      symbol: string
      balance: string
      isSecure: boolean
      isSafeMint: boolean
      statusMessage: string
    }> = []
    let activeCount = 0;
    let dormantCount = 0;

    for (const account of accounts) {
      try {
        const accountPubkey = account.pubkey;
        const accountData = account.account.data.parsed.info;
        const mint = accountData.mint;
        const balance = accountData.tokenAmount.uiAmount || 0;
        const decimals = accountData.tokenAmount.decimals;
        const delegate = accountData.delegate || null;
        const delegatedAmount = accountData.delegatedAmount?.uiAmount || 0;
        const owner = accountData.owner;

        writeLog(`[Account] ${accountPubkey}`)
        writeLog(`  Mint: ${mint}`)
        writeLog(`  Balance: ${balance}`)
        writeLog(`  Delegate: ${delegate}`)
        writeLog(`  Delegated Amount: ${delegatedAmount}`)
        writeLog(`  Owner: ${owner}`)

        // Fetch token metadata
        const metadata = await fetchTokenMetadata(mint)
        writeLog(`  Token: ${metadata.symbol} (${metadata.name})`)
        
        // Track this account in scan stats
        const isSafeMint = SAFE_MINTS.includes(mint)
        const hasDelegate = delegate !== null
        const authorityChanged = owner !== walletAddress
        
        scannedAccounts.push({
          mint: mint,
          symbol: metadata.symbol,
          balance: balance.toString(),
          isSecure: !hasDelegate && !authorityChanged,
          isSafeMint: isSafeMint,
          statusMessage: isSafeMint 
            ? 'Protected token (excluded from scan)'
            : !hasDelegate && !authorityChanged
            ? 'No permissions or authority issues'
            : hasDelegate
            ? `Active delegate: ${delegate?.slice(0, 8)}...`
            : 'Authority changed',
        })

        writeLog(`  Added to scan stats: ${isSafeMint ? 'SAFE_MINT' : hasDelegate || authorityChanged ? 'HAS_ISSUE' : 'SECURE'}`)

        // Skip safe mints
        if (isSafeMint) {
          writeLog(`  → SKIPPED (safe mint)`)
          continue;
        }

        // Only track accounts with delegates or authority issues
        writeLog(`  Has Delegate: ${hasDelegate} | Authority Changed: ${authorityChanged}`)

        if (!hasDelegate && !authorityChanged) {
          writeLog(`  → SKIPPED (no security concern)`)
          continue; // Skip - no security concern
        }

        const risk = analyzeRisk(
          delegate,
          delegatedAmount,
          decimals,
          owner,
          walletAddress,
          balance
        );

        // Check if dormant (no recent activity - we'll estimate this)
        // In production, you'd check transaction history
        const isDormant = balance === 0 && hasDelegate;

        if (isDormant) dormantCount++;
        if (hasDelegate && !isDormant) activeCount++;

        permissions.push({
          address: accountPubkey,
          mint: mint,
          delegate: delegate,
          delegatedAmount: delegatedAmount,
          decimals: decimals,
          tokenSymbol: metadata.symbol,
          tokenName: metadata.name,
          authority: owner,
          riskLevel: risk.level,
          riskReason: risk.reason,
          isDormant: isDormant,
        });

        writeLog(`  ✓ Added permission: ${risk.level} - ${risk.reason}`);
      } catch (error) {
        writeLog(`  ✗ Error processing account: ${error}`);
        continue;
      }
    }

    writeLog(`[Summary] Total permissions found: ${permissions.length}`)
    writeLog(`[Summary] Active: ${activeCount} | Dormant: ${dormantCount}`)
    writeLog(`[Summary] Total accounts scanned: ${scannedAccounts.length}`)

    const { score, status, criticalCount, recommendations } = calculateSecurityScore(permissions);

    writeLog(`[Result] Score: ${score}/100 (${status})`)
    writeLog(`[Result] Total permissions: ${permissions.length}`)
    writeLog(`[Result] Critical issues: ${criticalCount}`)

    return {
      permissions,
      securityScore: score,
      scoreStatus: status,
      totalPermissions: permissions.length,
      activePermissions: activeCount,
      dormantPermissions: dormantCount,
      criticalIssues: criticalCount,
      recommendations,
      scanStats: {
        totalAccounts: scannedAccounts.length,
        scannedAccounts: scannedAccounts,
      },
    };
  } catch (error) {
    writeLog(`[Error] Exception during scan: ${error}`);
    return {
      permissions: [],
      securityScore: 100,
      scoreStatus: 'safe',
      totalPermissions: 0,
      activePermissions: 0,
      dormantPermissions: 0,
      criticalIssues: 0,
      recommendations: ['Scan error - please try again'],
      scanStats: {
        totalAccounts: 0,
        scannedAccounts: [],
      },
    };
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
    writeLog(`[Handler] ✗ Method not allowed: ${req.method}`)
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { address } = req.query;
  writeLog(`[Handler] Request received for address: ${address}`)

  if (!address || typeof address !== 'string') {
    writeLog('[Handler] ✗ Invalid address parameter')
    return res.status(400).json({
      error: 'Wallet address required',
      permissions: [],
      securityScore: 0,
      scoreStatus: 'critical',
      totalPermissions: 0,
      activePermissions: 0,
      dormantPermissions: 0,
      criticalIssues: 0,
      recommendations: [],
      scanStats: {
        totalAccounts: 0,
        scannedAccounts: [],
      },
    });
  }

  if (!HELIUS_API_KEY) {
    writeLog('[Handler] ✗ Missing HELIUS_API_KEY')
    return res.status(500).json({
      error: 'Server configuration error',
      permissions: [],
      securityScore: 0,
      scoreStatus: 'critical',
      totalPermissions: 0,
      activePermissions: 0,
      dormantPermissions: 0,
      criticalIssues: 0,
      recommendations: [],
      scanStats: {
        totalAccounts: 0,
        scannedAccounts: [],
      },
    });
  }

  try {
    const result = await scanWalletSecurity(address);
    writeLog('[Handler] ✓ Scan complete, returning result')
    return res.status(200).json(result);
  } catch (error) {
    writeLog(`[Handler] ✗ Exception: ${error}`)
    return res.status(500).json({
      error: 'Failed to scan wallet security',
      details: String(error),
      permissions: [],
      securityScore: 0,
      scoreStatus: 'critical',
      totalPermissions: 0,
      activePermissions: 0,
      dormantPermissions: 0,
      criticalIssues: 0,
      recommendations: [],
      scanStats: {
        totalAccounts: 0,
        scannedAccounts: [],
      },
    });
  }
}