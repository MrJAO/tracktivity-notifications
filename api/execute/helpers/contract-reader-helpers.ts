// Known program mappings for better UX
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

// Known token mints for better symbol display
export const KNOWN_TOKENS: Record<string, { symbol: string, name: string }> = {
  'So11111111111111111111111111111111111111112': { symbol: 'SOL', name: 'Solana' },
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { symbol: 'USDC', name: 'USD Coin' },
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': { symbol: 'USDT', name: 'Tether USD' },
  'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3': { symbol: 'SKR', name: 'Seeker' },
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': { symbol: 'mSOL', name: 'Marinade SOL' },
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn': { symbol: 'JitoSOL', name: 'Jito Staked SOL' },
}

// Analyze risk based on transaction type
export function analyzeTransactionRisk(type: string): {
  risk: 'safe' | 'low' | 'medium' | 'high' | 'critical'
  reason?: string
} {
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
    'NFT_MINT': { risk: 'safe', reason: 'NFT mint' },
    'TOKEN_MINT': { risk: 'safe', reason: 'Token mint' },
    'STAKE': { risk: 'safe', reason: 'Staking transaction' },
    'UNSTAKE': { risk: 'safe', reason: 'Unstaking transaction' },
    'UNKNOWN': { risk: 'medium', reason: 'Unknown transaction type - verify manually' },
  }
  
  const normalized = type.toUpperCase().replace(/[-_\s]/g, '_')
  
  for (const [key, value] of Object.entries(riskMap)) {
    if (normalized.includes(key)) {
      return value
    }
  }
  
  return { risk: 'safe', reason: 'Standard transaction' }
}

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

// Generate human-readable description from transaction data
export function generateDescription(
  type: string,
  source: string,
  tokenTransfers: any[],
  nativeTransfers: any[]
): string {
  const normalizedType = type.toUpperCase()
  
  // SWAP transactions
  if (normalizedType.includes('SWAP')) {
    const significantTransfers = tokenTransfers.filter(t => parseFloat(t.tokenAmount) > 0.001)
    
    if (significantTransfers.length >= 2) {
      const fromTransfer = significantTransfers[0]
      const toTransfer = significantTransfers[significantTransfers.length - 1]
      
      const fromToken = getTokenInfo(fromTransfer.mint)
      const toToken = getTokenInfo(toTransfer.mint)
      
      const fromAmount = fromTransfer.tokenAmount
      const toAmount = toTransfer.tokenAmount
      
      return `Swapped ${fromAmount} ${fromToken.symbol} for ${toAmount} ${toToken.symbol} via ${source}`
    }
    
    if (tokenTransfers.length > 0) {
      return `Token swap via ${source} (${tokenTransfers.length} transfers)`
    }
    
    return `Token swap via ${source}`
  }
  
  // TRANSFER transactions
  if (normalizedType.includes('TRANSFER')) {
    if (nativeTransfers.length > 0) {
      const transfer = nativeTransfers[0]
      const amount = (transfer.amount / 1e9).toFixed(4)
      return `Transferred ${amount} SOL`
    }
    
    if (tokenTransfers.length > 0) {
      const transfer = tokenTransfers[0]
      const tokenInfo = getTokenInfo(transfer.mint)
      return `Transferred ${transfer.tokenAmount} ${tokenInfo.symbol}`
    }
    
    return 'Token/SOL transfer'
  }
  
  // NFT transactions
  if (normalizedType.includes('NFT')) {
    if (normalizedType.includes('SALE')) {
      return `NFT sale on ${source}`
    }
    if (normalizedType.includes('LISTING')) {
      return `NFT listed on ${source}`
    }
    if (normalizedType.includes('BID')) {
      return `NFT bid placed on ${source}`
    }
    if (normalizedType.includes('MINT')) {
      return `NFT minted`
    }
    return `NFT transaction on ${source}`
  }
  
  // STAKE/UNSTAKE
  if (normalizedType.includes('STAKE')) {
    if (tokenTransfers.length > 0) {
      const transfer = tokenTransfers[0]
      const tokenInfo = getTokenInfo(transfer.mint)
      return `Staked ${transfer.tokenAmount} ${tokenInfo.symbol} via ${source}`
    }
    return `Staking via ${source}`
  }
  
  if (normalizedType.includes('UNSTAKE')) {
    if (tokenTransfers.length > 0) {
      const transfer = tokenTransfers[0]
      const tokenInfo = getTokenInfo(transfer.mint)
      return `Unstaked ${transfer.tokenAmount} ${tokenInfo.symbol} via ${source}`
    }
    return `Unstaking via ${source}`
  }
  
  // BURN
  if (normalizedType.includes('BURN')) {
    if (tokenTransfers.length > 0) {
      const transfer = tokenTransfers[0]
      const tokenInfo = getTokenInfo(transfer.mint)
      return `Burned ${transfer.tokenAmount} ${tokenInfo.symbol}`
    }
    return 'Token burn'
  }
  
  // APPROVE
  if (normalizedType.includes('APPROVE')) {
    return `Token approval granted to ${source}`
  }
  
  // SET_AUTHORITY
  if (normalizedType.includes('SET_AUTHORITY') || normalizedType.includes('SETAUTHORITY')) {
    return `Authority changed on ${source}`
  }
  
  // CLOSE_ACCOUNT
  if (normalizedType.includes('CLOSE_ACCOUNT') || normalizedType.includes('CLOSEACCOUNT')) {
    return `Account closed`
  }
  
  // Generic fallback
  if (tokenTransfers.length > 0 || nativeTransfers.length > 0) {
    const totalTransfers = tokenTransfers.length + nativeTransfers.length
    return `${type} on ${source} (${totalTransfers} transfer${totalTransfers !== 1 ? 's' : ''})`
  }
  
  return `${type} on ${source}`
}

// Generate simpler summary for UI display
export function generateSimpleSummary(
  type: string,
  tokenTransfers: any[],
  nativeTransfers: any[]
): string {
  const normalizedType = type.toUpperCase()
  
  if (normalizedType.includes('SWAP') && tokenTransfers.length >= 2) {
    const fromToken = getTokenInfo(tokenTransfers[0].mint)
    const toToken = getTokenInfo(tokenTransfers[tokenTransfers.length - 1].mint)
    return `${fromToken.symbol} → ${toToken.symbol}`
  }
  
  if (normalizedType.includes('TRANSFER')) {
    return 'Transfer'
  }
  
  if (normalizedType.includes('NFT')) {
    return 'NFT Transaction'
  }
  
  if (normalizedType.includes('STAKE')) {
    return 'Staking'
  }
  
  return type
}