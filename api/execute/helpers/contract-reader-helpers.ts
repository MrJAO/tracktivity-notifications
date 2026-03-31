export const KNOWN_PROGRAMS: Record<string, string> = {
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA': 'Token Program',
  '11111111111111111111111111111111': 'System Program',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL': 'Associated Token Program',
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'Jupiter Aggregator',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium AMM',
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'Orca Whirlpool',
  'M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K': 'Magic Eden v2',
  'TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN': 'Tensor Swap',
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s': 'Metaplex Token Metadata',
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK': 'Raydium CLMM',
  'goonuddtQRrWqqn5nFyczVKaie28f3kDkHWkHtURSLE': 'Goosefx',
}

// Known token mints (kept for context enrichment)
export const KNOWN_TOKENS: Record<string, { symbol: string, name: string }> = {
  'So11111111111111111111111111111111111111112': { symbol: 'SOL', name: 'Solana' },
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { symbol: 'USDC', name: 'USD Coin' },
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': { symbol: 'USDT', name: 'Tether USD' },
  'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3': { symbol: 'SKR', name: 'Seeker' },
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': { symbol: 'mSOL', name: 'Marinade SOL' },
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn': { symbol: 'JitoSOL', name: 'Jito Staked SOL' },
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''

// Get token info from mint address
export function getTokenInfo(mint: string): { symbol: string, name: string } {
  if (KNOWN_TOKENS[mint]) {
    return KNOWN_TOKENS[mint]
  }
  return {
    symbol: `${mint.slice(0, 4)}...${mint.slice(-4)}`,
    name: 'Unknown Token'
  }
}

// Format token amount with symbol
export function formatTokenAmount(amount: number | string, mint?: string): string {
  const amountStr = typeof amount === 'number' ? amount.toString() : amount
  
  if (!mint) {
    return amountStr
  }
  
  const tokenInfo = getTokenInfo(mint)
  return `${amountStr} ${tokenInfo.symbol}`
}

// Build optimized AI prompt for security analysis
function buildAIPrompt(
  type: string,
  source: string,
  tokenTransfers: any[],
  nativeTransfers: any[]
): string {
  const programName = KNOWN_PROGRAMS[source] || 'Unknown Program'
  const totalTransfers = tokenTransfers.length + nativeTransfers.length
  
  let transferContext = ''
  if (tokenTransfers.length > 0) {
    const firstTransfer = tokenTransfers[0]
    const tokenInfo = getTokenInfo(firstTransfer.mint)
    transferContext = `${tokenTransfers.length} token transfer(s) involving ${tokenInfo.symbol}. `
  }
  
  if (nativeTransfers.length > 0) {
    transferContext += `${nativeTransfers.length} SOL transfer(s). `
  }
  
  return `Analyze this Solana transaction for security risks:

Transaction Type: ${type}
Program Used: ${programName}
Total Transfers: ${totalTransfers}
Details: ${transferContext}

Provide a security-focused analysis answering:
1. What specific action occurred? (Be precise - not just "transfer")
2. Is this transaction safe, risky, spam, or suspicious?
3. What specific security indicators support your verdict?

You must respond with valid JSON only (no markdown, no explanation):
{
  "explanation": "Clear description of what happened and safety verdict with specific reasons",
  "risk": "safe|low|medium|high|critical",
  "reason": "Specific security indicators that determine this risk level"
}`
}

// Call OpenAI API for analysis
async function callOpenAI(prompt: string): Promise<any> {
  console.log('🔍 [OpenAI] Starting API call...')
  console.log('🔍 [OpenAI] API Key exists:', !!OPENAI_API_KEY)
  
  try {
    if (!OPENAI_API_KEY) {
      console.error('❌ [OpenAI] API key not configured')
      throw new Error('OpenAI API key not configured')
    }

    const requestBody = {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a Solana blockchain security analyst. Always respond with valid JSON only, no markdown formatting.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 500,
      response_format: { type: 'json_object' }
    }
    
    console.log('📤 [OpenAI] Sending request...')

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    console.log('📥 [OpenAI] Response status:', response.status)

    if (!response.ok) {
      const errorText = await response.text()
      console.error('❌ [OpenAI] Error response:', errorText)
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    console.log('✅ [OpenAI] Response received')
    
    return data
  } catch (error) {
    console.error('❌ [OpenAI] Error:', error)
    throw error
  }
}

// Get AI explanation and risk analysis
export async function getAIAnalysis(
  type: string,
  source: string,
  tokenTransfers: any[],
  nativeTransfers: any[]
): Promise<{
  explanation: string
  risk: 'safe' | 'low' | 'medium' | 'high' | 'critical'
  reason: string
}> {
  console.log('🚀 [AI Analysis] Starting analysis...')
  
  try {
    const prompt = buildAIPrompt(type, source, tokenTransfers, nativeTransfers)
    const response = await callOpenAI(prompt)
    
    console.log('🔄 [AI Analysis] Processing response...')
    
    if (!response?.choices?.[0]?.message?.content) {
      console.error('❌ [AI Analysis] Invalid response structure')
      throw new Error('Invalid AI response')
    }
    
    const content = response.choices[0].message.content.trim()
    console.log('📝 [AI Analysis] Response text:', content)
    
    let parsed
    try {
      parsed = JSON.parse(content)
      console.log('✅ [AI Analysis] Parsed successfully')
    } catch (parseError) {
      console.error('❌ [AI Analysis] Parse error:', parseError)
      throw new Error('Failed to parse AI response')
    }
    
    return {
      explanation: parsed.explanation || 'Transaction analysis completed',
      risk: parsed.risk || 'medium',
      reason: parsed.reason || 'Unable to determine specific risk factors'
    }
  } catch (error) {
    console.error('❌ [AI Analysis] Error:', error)
    
    const programName = KNOWN_PROGRAMS[source] || 'Solana program'
    const transferCount = tokenTransfers.length + nativeTransfers.length
    
    return {
      explanation: `${type} transaction via ${programName} with ${transferCount} transfer(s). Manual verification recommended - automated security analysis unavailable.`,
      risk: 'medium',
      reason: 'AI security analysis unavailable - verify transaction manually before proceeding'
    }
  }
}