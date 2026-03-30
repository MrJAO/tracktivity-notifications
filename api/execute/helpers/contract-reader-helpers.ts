// Known program mappings (kept for context enrichment)
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

const BYTEZ_API_KEY = process.env.BYTEZ_API_KEY || ''
const BYTEZ_API_URL = 'https://api.bytez.com'

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

// Build optimized AI prompt
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
    transferContext = `Involves ${tokenInfo.symbol} token transfer. `
  }
  
  if (nativeTransfers.length > 0) {
    transferContext += `Includes SOL transfer. `
  }
  
  const prompt = `Analyze this Solana transaction and respond with ONLY a JSON object (no markdown, no extra text):

Transaction Type: ${type}
Program: ${programName}
Total Transfers: ${totalTransfers}
${transferContext}

Required JSON format:
{
  "explanation": "2-3 sentence user-friendly explanation of what this transaction does",
  "risk": "safe|low|medium|high|critical",
  "reason": "Brief reason for risk level"
}

Respond ONLY with the JSON object.`

  return prompt
}

// Call Bytez AI
async function callBytezAI(prompt: string, maxTokens: number = 150): Promise<any> {
  try {
    if (!BYTEZ_API_KEY) {
      throw new Error('Bytez API key not configured')
    }

    const response = await fetch(`${BYTEZ_API_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${BYTEZ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'mistralai/Mistral-7B-Instruct-v0.1',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: maxTokens,
        temperature: 0.3,
      }),
    })

    if (!response.ok) {
      throw new Error(`Bytez API error: ${response.status}`)
    }

    const data = await response.json()
    return data
  } catch (error) {
    console.error('[Bytez AI] Error:', error)
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
  try {
    const prompt = buildAIPrompt(type, source, tokenTransfers, nativeTransfers)
    const response = await callBytezAI(prompt, 150)
    
    if (!response?.choices?.[0]?.message?.content) {
      throw new Error('Invalid AI response')
    }
    
    const content = response.choices[0].message.content.trim()
    
    // Try to parse JSON response
    let parsed
    try {
      // Remove markdown code blocks if present
      const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      parsed = JSON.parse(cleaned)
    } catch (parseError) {
      console.error('[Bytez AI] JSON parse error:', parseError)
      throw new Error('Failed to parse AI response')
    }
    
    return {
      explanation: parsed.explanation || 'Transaction analysis unavailable',
      risk: parsed.risk || 'medium',
      reason: parsed.reason || 'Unable to determine risk level'
    }
  } catch (error) {
    console.error('[Bytez AI] Analysis error:', error)
    
    // Fallback to basic analysis
    return {
      explanation: `${type} transaction on ${KNOWN_PROGRAMS[source] || 'Solana'}`,
      risk: 'medium',
      reason: 'AI analysis unavailable - verify manually'
    }
  }
}