import fetch from 'node-fetch';

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const RPC_ENDPOINT = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

const SAFE_MINTS = [
  'So11111111111111111111111111111111111111112',
  'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
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

function analyzeRisk(
  delegate: string | null,
  delegatedAmount: number,
  decimals: number,
  authority: string,
  walletAddress: string,
  balance: number
): { level: 'safe' | 'low' | 'medium' | 'high' | 'critical'; reason: string } {
  if (!delegate) {
    return { level: 'safe', reason: 'No active permissions' };
  }

  const maxU64 = BigInt('18446744073709551615');
  const delegatedRaw = BigInt(Math.floor(delegatedAmount * Math.pow(10, decimals)));

  if (authority !== walletAddress) {
    return {
      level: 'critical',
      reason: 'Authority changed - someone else controls this token!',
    };
  }

  if (delegatedRaw >= maxU64 / BigInt(2)) {
    return {
      level: 'high',
      reason: 'Unlimited approval granted',
    };
  }

  if (balance > 0 && delegatedAmount > balance * 0.5) {
    return {
      level: 'medium',
      reason: `Large approval: ${delegatedAmount.toFixed(2)} tokens`,
    };
  }

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
  let score = 100;
  let criticalCount = 0;
  const recommendations: string[] = [];

  for (const p of permissions) {
    if (p.riskLevel === 'critical') {
      score -= 40;
      criticalCount++;
      recommendations.push(`Revoke critical permission on ${p.tokenSymbol}`);
    } else if (p.riskLevel === 'high') {
      score -= 25;
      criticalCount++;
      recommendations.push(`Revoke unlimited approval on ${p.tokenSymbol}`);
    } else if (p.riskLevel === 'medium') {
      score -= 10;
    } else if (p.riskLevel === 'low') {
      score -= 5;
    }

    if (p.isDormant && p.delegate) {
      score -= 3;
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

  return { score, status, criticalCount, recommendations };
}

async function scanWalletSecurity(walletAddress: string): Promise<SecurityScanResult> {
  try {
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

        const metadata = await fetchTokenMetadata(mint)
        
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

        if (isSafeMint) {
          continue;
        }

        if (!hasDelegate && !authorityChanged) {
          continue;
        }

        const risk = analyzeRisk(
          delegate,
          delegatedAmount,
          decimals,
          owner,
          walletAddress,
          balance
        );

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
      } catch (error) {
        continue;
      }
    }

    const { score, status, criticalCount, recommendations } = calculateSecurityScore(permissions);

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
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { address } = req.query;

  if (!address || typeof address !== 'string') {
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
    return res.status(200).json(result);
  } catch (error) {
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