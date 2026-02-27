import 'dotenv/config';
import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';
import { Connection, PublicKey } from '@solana/web3.js';

// ============================================================================
// TYPES
// ============================================================================

interface SKRStatsData {
  lastUpdated: string;
  staking: {
    totalStaked: number;
    apy: number;
    inflationRate: number;
  };
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const FILES = {
  skrStats: path.join(__dirname, '..', 'skr-stats.json'),
  logs: path.join(__dirname, '..', 'logs'),
};

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const RPC_ENDPOINT = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

const SKR_TOKEN_MINT = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3';
const SEEKER_STAKING_VAULT = '8isViKbwhuhFhsv2t8vaFL74pKCqaFPQXo1KkeQwZbB8';
const SOLANA_MOBILE_STAKING_SITE = 'https://stake.solanamobile.com/';

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function writeLog(message: string): void {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  
  if (!fs.existsSync(FILES.logs)) {
    fs.mkdirSync(FILES.logs, { recursive: true });
  }

  const logFile = path.join(
    FILES.logs,
    `skr-stats-${new Date().toISOString().split('T')[0]}.log`
  );

  fs.appendFileSync(logFile, logMessage, 'utf-8');
  console.log(message);
}

function writeJSON(filePath: string, data: any): void {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`✓ Updated ${path.basename(filePath)}`);
  } catch (error) {
    console.error(`Error writing ${filePath}:`, error);
    throw error;
  }
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// DATA FETCHERS
// ============================================================================

async function fetchAPYAndInflation(): Promise<{ apy: number; inflationRate: number }> {
  try {
    writeLog('Scraping APY and Inflation Rate from Solana Mobile staking site...');
    
    const response = await fetch(SOLANA_MOBILE_STAKING_SITE);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch staking site: ${response.status}`);
    }

    const html = await response.text();
    
    // Multiple patterns to catch APY
    const apyPatterns = [
      /Earn\s+(\d+\.?\d*)\s*%\s+APY/i,           // "Earn 20.7% APY"
      /Current\s+Yield[^0-9]*(\d+\.?\d*)\s*%/i,   // "Current Yield 20.7%"
      /APY\s*\(current\)[^0-9]*(\d+\.?\d*)\s*%/i, // "APY (current)20.7%"
    ];
    
    // Multiple patterns to catch Inflation Rate
    const inflationPatterns = [
      /Inflation\s+Rate[^0-9]*(\d+\.?\d*)\s*%/i,  // "Inflation Rate10.0%"
      /inflation.*?(\d+\.?\d*)\s*%/i,              // any inflation text
    ];
    
    let apy: number | null = null;
    let inflationRate: number | null = null;
    
    // Try all APY patterns
    for (const pattern of apyPatterns) {
      const match = html.match(pattern);
      if (match) {
        apy = parseFloat(match[1]);
        break;
      }
    }
    
    // Try all Inflation patterns
    for (const pattern of inflationPatterns) {
      const match = html.match(pattern);
      if (match) {
        inflationRate = parseFloat(match[1]);
        break;
      }
    }
    
    if (apy === null || inflationRate === null) {
      writeLog('⚠ Could not parse APY or Inflation Rate from website');
      writeLog('Using fallback values: APY 20.3%, Inflation 10.0%');
      return { apy: 20.7, inflationRate: 10.0 };
    }
    
    writeLog(`✓ APY: ${apy}%`);
    writeLog(`✓ Inflation Rate: ${inflationRate}%`);
    
    return { apy, inflationRate };
  } catch (error) {
    writeLog(`✗ Failed to scrape APY/Inflation: ${error}`);
    writeLog('Using fallback values: APY 20.7%, Inflation 10.0%');
    return { apy: 20.7, inflationRate: 10.0 };
  }
}

async function fetchStakingData(): Promise<{ totalStaked: number }> {
  try {
    writeLog('Fetching staking data from Helius RPC...');
    
    if (!HELIUS_API_KEY) {
      throw new Error('HELIUS_API_KEY environment variable not set');
    }

    const connection = new Connection(RPC_ENDPOINT, 'confirmed');
    const vaultPubkey = new PublicKey(SEEKER_STAKING_VAULT);
    
    // Get total staked from the vault
    writeLog('Fetching vault balance...');
    const vaultInfo = await connection.getParsedAccountInfo(vaultPubkey);
    
    let totalStaked = 0;
    if (vaultInfo.value && 'parsed' in vaultInfo.value.data) {
      totalStaked = vaultInfo.value.data.parsed.info.tokenAmount.uiAmount || 0;
      writeLog(`✓ Total Staked (from vault): ${totalStaked.toLocaleString()} SKR`);
    } else {
      throw new Error('Could not parse vault balance');
    }
    
    return { totalStaked };
  } catch (error) {
    writeLog(`✗ Staking data fetch failed: ${error}`);
    throw error;
  }
}

// ============================================================================
// MAIN LOGIC
// ============================================================================

async function updateSKRStats(): Promise<void> {
  writeLog('════════════════════════════════════════════════════════════');
  writeLog('Starting SKR Stats Update');
  writeLog('════════════════════════════════════════════════════════════');

  try {
    // Fetch APY and Inflation Rate from website
    const { apy, inflationRate } = await fetchAPYAndInflation();
    await delay(2000); // Rate limit protection
    
    // Fetch staking data from RPC
    const stakingData = await fetchStakingData();
    
    // Combine all data
    const skrStats: SKRStatsData = {
      lastUpdated: new Date().toISOString(),
      staking: {
        totalStaked: stakingData.totalStaked,
        apy,
        inflationRate,
      }
    };
    
    // Write to file
    writeJSON(FILES.skrStats, skrStats);
    
    writeLog('════════════════════════════════════════════════════════════');
    writeLog('SKR Stats Update Complete');
    writeLog(`APY: ${apy}%`);
    writeLog(`Inflation Rate: ${inflationRate}%`);
    writeLog(`Total Staked: ${stakingData.totalStaked.toLocaleString()} SKR`);
    writeLog('════════════════════════════════════════════════════════════');

  } catch (error) {
    writeLog(`✗ Critical error: ${error}`);
    throw error;
  }
}

// ============================================================================
// ENTRY POINT
// ============================================================================

updateSKRStats()
  .then(() => {
    console.log('\n✓ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Script failed:', error);
    process.exit(1);
  });