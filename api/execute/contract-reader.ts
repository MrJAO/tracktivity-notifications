import fetch from 'node-fetch';

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
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

// Detect if input is transaction signature (base58, typically 88 chars) or program ID (base58, typically 32-44 chars)
function detectAddressType(address: string): 'transaction' | 'contract' {
  console.log('[ContractReader] Detecting type for address:', address, 'length:', address.length)
  
  // Transaction signatures are typically 88 characters
  if (address.length >= 80) {
    console.log('[ContractReader] Detected as TRANSACTION (length >= 80)')
    return 'transaction'
  }
  
  // Program IDs are typically 32-44 characters
  console.log('[ContractReader] Detected as CONTRACT (length < 80)')
  return 'contract'
}

// Analyze dangerous instruction patterns
function analyzeInstructionRisk(instructionType: string, programId: string): {
  risk: 'safe' | 'low' | 'medium' | 'high' | 'critical'
  reason?: string
} {
  console.log('[ContractReader] Analyzing risk for instruction:', instructionType, 'program:', programId)
  
  const dangerousInstructions = [
    'approve',
    'setAuthority',
    'closeAccount',
    'transferChecked',
    'burn',
  ]
  
  if (dangerousInstructions.includes(instructionType.toLowerCase())) {
    console.log('[ContractReader] DANGEROUS instruction detected:', instructionType)
    return { risk: 'high', reason: `Potentially dangerous: ${instructionType}` }
  }
  
  if (instructionType.toLowerCase().includes('transfer')) {
    console.log('[ContractReader] Transfer instruction detected')
    return { risk: 'medium', reason: 'Asset transfer' }
  }
  
  console.log('[ContractReader] Safe instruction')
  return { risk: 'safe' }
}

// Fetch AI explanation from Helius Agents
async function getHeliusAgentsExplanation(transactionSignature: string): Promise<string | null> {
  console.log('[ContractReader] Fetching Helius Agents explanation for:', transactionSignature)
  
  try {
    const response = await fetch(`https://api.helius.xyz/v0/transactions/${transactionSignature}/parsed?api-key=${HELIUS_API_KEY}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })
    
    console.log('[ContractReader] Helius Agents response status:', response.status)
    
    if (!response.ok) {
      console.error('[ContractReader] Helius Agents request failed:', response.status, response.statusText)
      return null
    }
    
    const data = await response.json() as any
    console.log('[ContractReader] Helius Agents raw response:', JSON.stringify(data, null, 2))
    
    // Extract natural language description from Helius response
    if (data?.description) {
      console.log('[ContractReader] Found description:', data.description)
      return data.description
    }
    
    // Fallback to type if no description
    if (data?.type) {
      console.log('[ContractReader] Using type as fallback:', data.type)
      return `Transaction type: ${data.type}`
    }
    
    console.log('[ContractReader] No explanation found in Helius response')
    return null
  } catch (error) {
    console.error('[ContractReader] Helius Agents error:', error)
    return null
  }
}

// Analyze transaction using Helius Enhanced Transactions API
async function analyzeTransaction(signature: string): Promise<ContractAnalysisResult> {
  console.log('[ContractReader] Analyzing TRANSACTION:', signature)
  
  try {
    // Get AI explanation first
    const aiExplanation = await getHeliusAgentsExplanation(signature)
    console.log('[ContractReader] AI Explanation result:', aiExplanation)
    
    // Fetch transaction details
    const response = await fetch(HELIUS_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'tx-analysis',
        method: 'getTransaction',
        params: [
          signature,
          {
            encoding: 'jsonParsed',
            maxSupportedTransactionVersion: 0,
          },
        ],
      }),
    })
    
    console.log('[ContractReader] Transaction fetch response status:', response.status)
    
    if (!response.ok) {
      console.error('[ContractReader] Transaction fetch failed:', response.status)
      throw new Error('Failed to fetch transaction')
    }
    
    const data = await response.json() as any
    console.log('[ContractReader] Transaction data keys:', Object.keys(data?.result || {}))
    
    const transaction = data?.result
    
    if (!transaction) {
      console.error('[ContractReader] No transaction data found')
      throw new Error('Transaction not found')
    }
    
    const instructions: InstructionDetail[] = []
    const tokenTransfers: TokenTransfer[] = []
    const accountChanges: AccountChange[] = []
    const warnings: string[] = []
    let overallRisk: 'safe' | 'low' | 'medium' | 'high' | 'critical' = 'safe'
    
    // Parse instructions
    const txInstructions = transaction?.transaction?.message?.instructions || []
    console.log('[ContractReader] Found', txInstructions.length, 'instructions')
    
    for (const instruction of txInstructions) {
      console.log('[ContractReader] Processing instruction:', instruction)
      
      const programId = instruction.programId || 'Unknown'
      const parsed = instruction.parsed
      const type = parsed?.type || instruction.program || 'Unknown'
      
      const riskAnalysis = analyzeInstructionRisk(type, programId)
      
      if (riskAnalysis.risk === 'high' || riskAnalysis.risk === 'critical') {
        overallRisk = riskAnalysis.risk
        warnings.push(riskAnalysis.reason || `Dangerous instruction: ${type}`)
      } else if (riskAnalysis.risk === 'medium' && overallRisk === 'safe') {
        overallRisk = 'medium'
      }
      
      instructions.push({
        type,
        program: programId,
        description: parsed?.info ? JSON.stringify(parsed.info) : undefined,
        risk: riskAnalysis.risk,
        details: parsed?.info || {},
      })
      
      // Extract token transfers
      if (type === 'transfer' || type === 'transferChecked') {
        const info = parsed?.info
        if (info?.source && info?.destination) {
          console.log('[ContractReader] Found token transfer:', info)
          tokenTransfers.push({
            from: info.source,
            to: info.destination,
            amount: info.amount || info.tokenAmount?.uiAmount || '0',
            mint: info.mint,
          })
        }
      }
    }
    
    console.log('[ContractReader] Analysis complete. Instructions:', instructions.length, 'Transfers:', tokenTransfers.length, 'Risk:', overallRisk)
    
    return {
      type: 'transaction',
      address: signature,
      aiExplanation: aiExplanation || undefined,
      overallRisk,
      summary: {
        totalInstructions: instructions.length,
        accountsInvolved: new Set(instructions.map(i => i.program).filter(Boolean)).size,
        tokensTransferred: tokenTransfers.length,
      },
      instructions,
      tokenTransfers,
      accountChanges,
      warnings,
    }
  } catch (error) {
    console.error('[ContractReader] Transaction analysis error:', error)
    throw error
  }
}

// Analyze contract/program (simplified - just return basic info)
async function analyzeContract(programId: string): Promise<ContractAnalysisResult> {
  console.log('[ContractReader] Analyzing CONTRACT:', programId)
  
  try {
    // For contracts, we can fetch account info
    const response = await fetch(HELIUS_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'contract-analysis',
        method: 'getAccountInfo',
        params: [
          programId,
          { encoding: 'jsonParsed' },
        ],
      }),
    })
    
    console.log('[ContractReader] Contract fetch response status:', response.status)
    
    if (!response.ok) {
      console.error('[ContractReader] Contract fetch failed:', response.status)
      throw new Error('Failed to fetch contract')
    }
    
    const data = await response.json() as any
    console.log('[ContractReader] Contract data:', JSON.stringify(data, null, 2))
    
    const accountInfo = data?.result?.value
    
    if (!accountInfo) {
      console.error('[ContractReader] Contract not found')
      throw new Error('Contract not found')
    }
    
    console.log('[ContractReader] Contract analysis complete')
    
    return {
      type: 'contract',
      address: programId,
      aiExplanation: `This is a Solana program (smart contract). Program ID: ${programId}`,
      overallRisk: 'safe',
      summary: {
        totalInstructions: 0,
        accountsInvolved: 1,
      },
      instructions: [{
        type: 'Program Account',
        program: programId,
        description: 'Smart contract deployed on Solana',
        risk: 'safe',
        details: {
          owner: accountInfo.owner,
          executable: accountInfo.executable,
          lamports: accountInfo.lamports,
        },
      }],
      warnings: ['Contract analysis is limited. For detailed analysis, paste a transaction signature that uses this program.'],
    }
  } catch (error) {
    console.error('[ContractReader] Contract analysis error:', error)
    throw error
  }
}

export default async function handler(req: any, res: any) {
  console.log('[ContractReader] API Handler called')
  console.log('[ContractReader] Method:', req.method)
  console.log('[ContractReader] Query:', req.query)
  
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    console.log('[ContractReader] OPTIONS request')
    return res.status(200).end()
  }

  if (req.method !== 'GET') {
    console.log('[ContractReader] Invalid method:', req.method)
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { address } = req.query

  if (!address || typeof address !== 'string') {
    console.log('[ContractReader] Missing or invalid address')
    return res.status(400).json({ error: 'Address required' })
  }

  if (!HELIUS_API_KEY) {
    console.error('[ContractReader] Missing HELIUS_API_KEY')
    return res.status(500).json({ error: 'Server configuration error' })
  }

  try {
    const addressType = detectAddressType(address)
    console.log('[ContractReader] Address type:', addressType)
    
    let result: ContractAnalysisResult
    
    if (addressType === 'transaction') {
      result = await analyzeTransaction(address)
    } else {
      result = await analyzeContract(address)
    }
    
    console.log('[ContractReader] Returning result:', JSON.stringify(result, null, 2))
    return res.status(200).json(result)
  } catch (error: any) {
    console.error('[ContractReader] Handler error:', error)
    return res.status(500).json({
      error: 'Analysis failed',
      details: error.message || String(error),
    })
  }
}