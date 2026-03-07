import fetch from 'node-fetch';
import bs58 from 'bs58';

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const RPC_ENDPOINT = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const STAKING_PROGRAM = 'SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ';

function writeLog(message: string): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

async function fetchStakedSKR(walletAddress: string): Promise<number> {
  try {
    writeLog(`Fetching staked SKR for: ${walletAddress}`);

    // Fetch sharePrice from StakeConfig
    const cfgRes = await fetch(RPC_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAccountInfo',
        params: [
          '4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw',
          { encoding: 'base64' },
        ],
      }),
    });

    const cfgJson = await cfgRes.json() as any;
    const cfgRaw = cfgJson?.result?.value?.data?.[0];
    if (!cfgRaw) {
      writeLog('✗ Could not fetch StakeConfig account');
      return 0;
    }

    const cfgData = Buffer.from(cfgRaw, 'base64');
    const sharePrice = cfgData.readBigUInt64LE(137);
    writeLog(`✓ sharePrice: ${sharePrice}`);

    // Fetch all userStake accounts
    const res = await fetch(RPC_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'getProgramAccounts',
        params: [
          STAKING_PROGRAM,
          {
            encoding: 'base64',
            filters: [
              {
                memcmp: {
                  offset: 0,
                  bytes: 'J6ZWGMgjwQC',
                },
              },
              { dataSize: 169 },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      writeLog(`✗ RPC request failed: ${res.status}`);
      return 0;
    }

    const json = await res.json() as any;
    const accounts = json?.result || [];
    writeLog(`✓ Found ${accounts.length} userStake accounts`);

    let totalStaked = 0;

    for (const account of accounts) {
      try {
        const data = Buffer.from(account.account.data[0], 'base64');
        if (data.length !== 169) continue;

        const ownerBytes = data.slice(41, 73);
        const owner = bs58.encode(ownerBytes);

        // Check if this account belongs to the wallet we're querying
        if (owner !== walletAddress) continue;

        const shares = data.readBigUInt64LE(104);
        if (shares === 0n) continue;

        const skr = Number(shares) * Number(sharePrice) / 1e15 / 256;
        if (skr <= 0 || skr > 100_000_000) continue;

        totalStaked += skr;
      } catch {
        continue;
      }
    }

    const rounded = Math.round(totalStaked * 100) / 100;
    writeLog(`✓ Total staked SKR: ${rounded}`);
    return rounded;

  } catch (error) {
    writeLog(`✗ Error fetching staked SKR: ${error}`);
    return 0;
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
    return res.status(400).json({ error: 'Wallet address required', stakedSKR: 0 });
  }

  if (!HELIUS_API_KEY) {
    return res.status(500).json({ error: 'Server configuration error', stakedSKR: 0 });
  }

  try {
    const stakedSKR = await fetchStakedSKR(address);
    return res.status(200).json({ stakedSKR });
  } catch (error) {
    return res.status(500).json({ 
      error: 'Failed to fetch staked SKR',
      details: String(error),
      stakedSKR: 0
    });
  }
}