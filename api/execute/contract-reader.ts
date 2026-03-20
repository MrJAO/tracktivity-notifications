import fetch from 'node-fetch';

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const HELIUS_ENHANCED_API = `https://api-mainnet.helius-rpc.com/v0/transactions?api-key=${HELIUS_API_KEY}`;
const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

interface InstructionDetail {
  type: string
  program?: string
  description?: string
  risk?: 'safe' | 'low' | 'medium' | 'high' | 'critical'
  details?: Record<string, any>
}

interface TokenTransfer {
  from: string
  to: string
  amount: string
  symbol?: string
  mint?: string
}

interface AccountChange {
  account: string
  type: string
  description?: string
}

interface ContractAnalysisResult {
  type: 'transaction' | 'contract'
  address: string
  aiExplanation?: string
  overallRisk: 'safe' | 'low' | 'medium' | 'high' | 'critical'
  summary?: {
    totalInstructions?: number
    accountsInvolved?: number
    tokensTransferred?: number
  }
  instructions?: InstructionDetail[]
  tokenTransfers?: TokenTransfer[]
  accountChanges?: AccountChange[]
  warnings?: string[]
}

// Common program mappings for better UX
const KNOWN_PROGRAMS: Record<string, string> = {
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA': 'Token Program',
  '11111111111111111111111111111111': 'System Program',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL': 'Associated Token Program',
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'Jupiter Aggregator',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium AMM',
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'Orca Whirlpool',
  'M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K': 'Magic Eden v2',
  'TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN': 'Tensor Swap',
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s': 'Metaplex Token Metadata',
}

// Detect transaction vs contract
function detectAddressType(address: string): 'transaction' | 'contract' {
  console.log('[ContractReader] Detecting type for address length:', address.length)
  return address.length >= 80 ? 'transaction' : 'contract'
}

// Analyze risk based on transaction type
function analyzeTransactionRisk(type: string): {
  risk: 'safe' | 'low' | 'medium' | 'high' | 'critical'
  reason?: string
} {
  console.log('[ContractReader] Analyzing risk for type:', type)
  
  const riskMap: Record<string, { risk: 'safe' | 'low' | 'medium' | 'high' | 'critical', reason: string }> = {
    'APPROVE_TOKEN': { risk: 'high', reason: 'Token approval - grants spending permission' },
    'APPROVE': { risk: 'high', reason: 'Approval detected - review carefully' },
    'SET_AUTHORITY': { risk: 'critical', reason: 'Authority change - control transfer' },
    'CLOSE_ACCOUNT': { risk: 'medium', reason: 'Account closure - permanent action' },
    'BURN': { risk: 'medium', reason: 'Token burn - destroys tokens' },
    'BURN_NFT': { risk: 'medium', reason: 'NFT burn - permanent deletion' },
    'TRANSFER': { risk: 'low', reason: 'Token/SOL transfer' },
    'SWAP': { risk: 'safe', reason: 'DEX swap transaction' },
    'NFT_SALE': { risk: 'safe', reason: 'NFT marketplace sale' },
    'NFT_LISTING': { risk: 'safe', reason: 'NFT listing on marketplace' },
    'NFT_BID': { risk: 'safe', reason: 'NFT bid placement' },
    'UNKNOWN': { risk: 'medium', reason: 'Unknown transaction type - verify manually' },
  }
  
  const normalized = type.toUpperCase().replace(/[-_\s]/g, '_')
  
  for (const [key, value] of Object.entries(riskMap)) {
    if (normalized.includes(key)) {
      console.log('[ContractReader] Risk matched:', key, value.risk)
      return value
    }
  }
  
  console.log('[ContractReader] Default safe risk')
  return { risk: 'safe', reason: 'Standard transaction' }
}

// Analyze transaction using Helius Enhanced Transactions API
async function analyzeTransaction(signature: string): Promise<ContractAnalysisResult> {
  console.log('[ContractReader] Analyzing TRANSACTION with Enhanced API:', signature)
  
  try {
    const response = await fetch(HELIUS_ENHANCED_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transactions: [signature],
      }),
    })
    
    console.log('[ContractReader] Enhanced API response status:', response.status)
    
    if (!response.ok) {
      console.error('[ContractReader] Enhanced API failed:', response.status)
      throw new Error('Failed to fetch transaction from Enhanced API')
    }
    
    const data = await response.json() as any
    console.log('[ContractReader] Enhanced API data keys:', Object.keys(data?.[0] || {}))
    
    const tx = data?.[0]
    
    if (!tx) {
      console.error('[ContractReader] No transaction data in response')
      throw new Error('Transaction not found')
    }
    
    // Extract Enhanced API data
    const description = tx.description || 'No description available'
    const txType = tx.type || 'UNKNOWN'
    const source = tx.source || 'Unknown'
    const fee = tx.fee || 0
    const timestamp = tx.timestamp || 0
    const tokenTransfersRaw = tx.tokenTransfers || []
    const nativeTransfersRaw = tx.nativeTransfers || []
    const accountDataRaw = tx.accountData || []
    const eventsRaw = tx.events || {}
    
    console.log('[ContractReader] Extracted - Type:', txType, 'Source:', source, 'Token Transfers:', tokenTransfersRaw.length)
    
    // Analyze risk
    const riskAnalysis = analyzeTransactionRisk(txType)
    const overallRisk = riskAnalysis.risk
    const warnings: string[] = []
    
    if (overallRisk === 'high' || overallRisk === 'critical') {
      warnings.push(riskAnalysis.reason || 'High risk transaction detected')
    }
    
    // Build human-readable instructions
    const instructions: InstructionDetail[] = []
    
    // Main instruction from type
    instructions.push({
      type: txType,
      program: source,
      description: description,
      risk: riskAnalysis.risk,
      details: {
        source: source,
        fee: `${fee / 1e9} SOL`,
        timestamp: new Date(timestamp * 1000).toISOString(),
      },
    })
    
    // Parse token transfers
    const tokenTransfers: TokenTransfer[] = tokenTransfersRaw.map((transfer: any) => ({
      from: transfer.fromUserAccount || 'Unknown',
      to: transfer.toUserAccount || 'Unknown',
      amount: transfer.tokenAmount?.toString() || '0',
      symbol: transfer.mint ? `${transfer.mint.slice(0, 4)}...${transfer.mint.slice(-4)}` : undefined,
      mint: transfer.mint,
    }))
    
    // Parse native SOL transfers
    const nativeTransfers = nativeTransfersRaw.map((transfer: any) => ({
      from: transfer.fromUserAccount || 'Unknown',
      to: transfer.toUserAccount || 'Unknown',
      amount: `${(transfer.amount || 0) / 1e9} SOL`,
      symbol: 'SOL',
    }))
    
    // Combine transfers
    const allTransfers = [...tokenTransfers, ...nativeTransfers]
    
    // Parse account changes
    const accountChanges: AccountChange[] = accountDataRaw.map((acc: any) => ({
      account: acc.account || 'Unknown',
      type: acc.nativeBalanceChange ? 'Balance Change' : 'Token Change',
      description: acc.nativeBalanceChange 
        ? `SOL: ${(acc.nativeBalanceChange / 1e9).toFixed(4)}`
        : acc.tokenBalanceChanges?.[0]?.rawTokenAmount?.tokenAmount || 'Changed',
    }))
    
    console.log('[ContractReader] Analysis complete - Transfers:', allTransfers.length, 'Account changes:', accountChanges.length, 'Risk:', overallRisk)
    
    return {
      type: 'transaction',
      address: signature,
      aiExplanation: description,
      overallRisk,
      summary: {
        totalInstructions: 1,
        accountsInvolved: accountChanges.length,
        tokensTransferred: allTransfers.length,
      },
      instructions,
      tokenTransfers: allTransfers,
      accountChanges,
      warnings,
    }
  } catch (error) {
    console.error('[ContractReader] Enhanced API error:', error)
    throw error
  }
}

// Analyze contract/program
async function analyzeContract(programId: string): Promise<ContractAnalysisResult> {
  console.log('[ContractReader] Analyzing CONTRACT:', programId)
  
  try {
    const response = await fetch(HELIUS_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'contract',
        method: 'getAccountInfo',
        params: [programId, { encoding: 'jsonParsed' }],
      }),
    })
    
    console.log('[ContractReader] Contract response status:', response.status)
    
    if (!response.ok) {
      throw new Error('Failed to fetch contract')
    }
    
    const data = await response.json() as any
    const accountInfo = data?.result?.value
    
    if (!accountInfo) {
      throw new Error('Contract not found')
    }
    
    const programName = KNOWN_PROGRAMS[programId] || 'Unknown Program'
    const isExecutable = accountInfo.executable || false
    
    console.log('[ContractReader] Contract:', programName, 'Executable:', isExecutable)
    
    return {
      type: 'contract',
      address: programId,
      aiExplanation: `${programName} - ${isExecutable ? 'Executable program (smart contract)' : 'Non-executable account'}`,
      overallRisk: 'safe',
      summary: {
        totalInstructions: 0,
        accountsInvolved: 1,
      },
      instructions: [{
        type: programName,
        program: programId,
        description: isExecutable ? 'Smart contract deployed on Solana' : 'Data account',
        risk: 'safe',
        details: {
          owner: accountInfo.owner,
          executable: isExecutable,
          lamports: `${(accountInfo.lamports / 1e9).toFixed(4)} SOL`,
        },
      }],
      warnings: ['Contract analysis is limited. Paste a transaction signature that uses this program for detailed analysis.'],
    }
  } catch (error) {
    console.error('[ContractReader] Contract error:', error)
    throw error
  }
}

export default async function handler(req: any, res: any) {
  console.log('[ContractReader] Handler called - Method:', req.method)
  
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { address } = req.query

  if (!address || typeof address !== 'string') {
    return res.status(400).json({ error: 'Address required' })
  }

  if (!HELIUS_API_KEY) {
    console.error('[ContractReader] Missing HELIUS_API_KEY')
    return res.status(500).json({ error: 'Server configuration error' })
  }

  try {
    const addressType = detectAddressType(address)
    console.log('[ContractReader] Type:', addressType)
    
    const result = addressType === 'transaction' 
      ? await analyzeTransaction(address)
      : await analyzeContract(address)
    
    console.log('[ContractReader] Success - Risk:', result.overallRisk, 'Warnings:', result.warnings?.length || 0)
    return res.status(200).json(result)
  } catch (error: any) {
    console.error('[ContractReader] Error:', error.message)
    return res.status(500).json({
      error: 'Analysis failed',
      details: error.message || String(error),
    })
  }
}