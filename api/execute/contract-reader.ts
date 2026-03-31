import {
  KNOWN_PROGRAMS,
  getAIAnalysis,
  getTokenInfo,
} from './helpers/contract-reader-helpers';

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

function detectAddressType(address: string): 'transaction' | 'contract' {
  return address.length >= 80 ? 'transaction' : 'contract'
}

async function analyzeTransaction(signature: string): Promise<ContractAnalysisResult> {
  try {
    const response = await fetch(HELIUS_ENHANCED_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transactions: [signature],
      }),
    })
    
    if (!response.ok) {
      throw new Error('Failed to fetch transaction from Enhanced API')
    }
    
    const data = await response.json() as any
    const tx = data?.[0]
    
    if (!tx) {
      throw new Error('Transaction not found')
    }
    
    const txType = tx.type || 'UNKNOWN'
    const source = tx.source || 'Unknown'
    const fee = tx.fee || 0
    const timestamp = tx.timestamp || 0
    const tokenTransfersRaw = tx.tokenTransfers || []
    const nativeTransfersRaw = tx.nativeTransfers || []
    const accountDataRaw = tx.accountData || []
    
    const aiAnalysis = await getAIAnalysis(txType, source, tokenTransfersRaw, nativeTransfersRaw)
    
    const overallRisk = aiAnalysis.risk
    const warnings: string[] = []
    
    if (overallRisk === 'high' || overallRisk === 'critical') {
      warnings.push(aiAnalysis.reason)
    }
    
    const instructions: InstructionDetail[] = []
    
    instructions.push({
      type: txType,
      program: source,
      description: aiAnalysis.explanation,
      risk: aiAnalysis.risk,
      details: {
        source: source,
        fee: `${fee / 1e9} SOL`,
        timestamp: new Date(timestamp * 1000).toISOString(),
      },
    })
    
    const tokenTransfers: TokenTransfer[] = tokenTransfersRaw.map((transfer: any) => {
      const tokenInfo = getTokenInfo(transfer.mint)
      return {
        from: transfer.fromUserAccount || 'Unknown',
        to: transfer.toUserAccount || 'Unknown',
        amount: transfer.tokenAmount?.toString() || '0',
        symbol: tokenInfo.symbol,
        mint: transfer.mint,
      }
    })
    
    const nativeTransfers = nativeTransfersRaw.map((transfer: any) => ({
      from: transfer.fromUserAccount || 'Unknown',
      to: transfer.toUserAccount || 'Unknown',
      amount: `${(transfer.amount || 0) / 1e9} SOL`,
      symbol: 'SOL',
    }))
    
    const allTransfers = [...tokenTransfers, ...nativeTransfers]
    
    const accountChanges: AccountChange[] = accountDataRaw.map((acc: any) => ({
      account: acc.account || 'Unknown',
      type: acc.nativeBalanceChange ? 'Balance Change' : 'Token Change',
      description: acc.nativeBalanceChange 
        ? `SOL: ${(acc.nativeBalanceChange / 1e9).toFixed(4)}`
        : acc.tokenBalanceChanges?.[0]?.rawTokenAmount?.tokenAmount || 'Changed',
    }))
    
    return {
      type: 'transaction',
      address: signature,
      aiExplanation: aiAnalysis.explanation,
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
    throw error
  }
}

async function analyzeContract(programId: string): Promise<ContractAnalysisResult> {
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
    throw error
  }
}

export default async function handler(req: any, res: any) {
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
    return res.status(500).json({ error: 'Server configuration error' })
  }

  try {
    const addressType = detectAddressType(address)
    
    const result = addressType === 'transaction' 
      ? await analyzeTransaction(address)
      : await analyzeContract(address)
    
    return res.status(200).json(result)
  } catch (error: any) {
    return res.status(500).json({
      error: 'Analysis failed',
      details: error.message || String(error),
    })
  }
}