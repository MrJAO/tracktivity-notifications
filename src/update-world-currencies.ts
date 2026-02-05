import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// TYPES
// ============================================================================

interface WorldCurrenciesData {
  lastUpdated: string;
  rates: Record<string, number>;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const FILES = {
  worldCurrencies: path.join(__dirname, '..', 'world-currencies.json'),
  logs: path.join(__dirname, '..', 'logs'),
};

// Using ExchangeRate-API (1,500 requests/month free tier)
const API_ENDPOINT = 'https://api.exchangerate-api.com/v4/latest/USD';

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
    `world-currencies-${new Date().toISOString().split('T')[0]}.log`
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

// ============================================================================
// MAIN LOGIC
// ============================================================================

async function updateWorldCurrencies(): Promise<void> {
  writeLog('════════════════════════════════════════════════════════════');
  writeLog('Starting World Currencies Update');
  writeLog('════════════════════════════════════════════════════════════');

  try {
    writeLog('Fetching latest exchange rates...');
    
    const response = await fetch(API_ENDPOINT);
    
    if (!response.ok) {
      throw new Error(`API returned status ${response.status}`);
    }

    const data: any = await response.json();
    
    if (!data.rates) {
      throw new Error('Invalid API response - missing rates');
    }

    writeLog(`✓ Fetched ${Object.keys(data.rates).length} currency rates`);

    // Keep ALL rates - no filtering or prioritization
    const allRates: Record<string, number> = { USD: 1.0, ...data.rates };

    // Create output data
    const worldCurrenciesData: WorldCurrenciesData = {
      lastUpdated: new Date().toISOString(),
      rates: allRates,
    };

    // Write to file
    writeJSON(FILES.worldCurrencies, worldCurrenciesData);

    writeLog('════════════════════════════════════════════════════════════');
    writeLog(`World Currencies Update Complete: ${Object.keys(allRates).length} currencies`);
    writeLog('════════════════════════════════════════════════════════════');

  } catch (error) {
    writeLog(`✗ Critical error: ${error}`);
    throw error;
  }
}

// ============================================================================
// ENTRY POINT
// ============================================================================

updateWorldCurrencies()
  .then(() => {
    console.log('\n✓ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Script failed:', error);
    process.exit(1);
  });
