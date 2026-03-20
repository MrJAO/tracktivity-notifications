import fetch from 'node-fetch';
import {
  KNOWN_PROGRAMS,
  analyzeTransactionRisk,
  generateDescription,
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

// Detect transaction vs contract
function detectAddressType(address: string): 'transaction' | 'contract' {
  console.log('[ContractReader] Detecting type for address length:', address.length)
  return address.length >= 80 ? 'transaction' : 'contract'
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
      const errorText = await response.text()
      console.error('[ContractReader] Enhanced API failed with body:', errorText)
      throw new Error('Failed to fetch transaction from Enhanced API')
    }
    
    const data = await response.json() as any
    const tx = data?.[0]
    
    if (!tx) {
      console.error('[ContractReader] No transaction data in response')
      throw new Error('Transaction not found')
    }
    
    console.log('[ContractReader] Transaction type:', tx.type, 'source:', tx.source)
    
    // Extract Enhanced API data
    const txType = tx.type || 'UNKNOWN'
    const source = tx.source || 'Unknown'
    const fee = tx.fee || 0
    const timestamp = tx.timestamp || 0
    const tokenTransfersRaw = tx.tokenTransfers || []
    const nativeTransfersRaw = tx.nativeTransfers || []
    const accountDataRaw = tx.accountData || []
    
    // Generate description (use Helius if available, otherwise generate our own)
    let description = tx.description
    if (!description || description.trim() === '') {
      description = generateDescription(txType, source, tokenTransfersRaw, nativeTransfersRaw)
      console.log('[ContractReader] Generated description:', description)
    } else {
      console.log('[ContractReader] Using Helius description:', description)
    }
    
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
    
    // Parse token transfers with proper symbols
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
    
    console.log('[ContractReader] Analysis complete - Risk:', overallRisk, 'Transfers:', allTransfers.length)
    
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
    
    console.log('[ContractReader] Success - Risk:', result.overallRisk, 'Description:', result.aiExplanation?.slice(0, 50))
    return res.status(200).json(result)
  } catch (error: any) {
    console.error('[ContractReader] Error:', error.message)
    return res.status(500).json({
      error: 'Analysis failed',
      details: error.message || String(error),
    })
  }
}