import fetch from 'node-fetch';

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const RPC_ENDPOINT = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const SOLANA_MOBILE_VOTE_ACCOUNT = 'SKRuTecmFDZHjs2DxRTJNEK7m7hunKGTWJiaZ3tMVVA';
const STAKE_PROGRAM_ID = 'Stake11111111111111111111111111111111111111';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function writeLog(message: string): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

function encodeBase58(buffer: Buffer): string {
  const digits: number[] = [0];
  for (let i = 0; i < buffer.length; i++) {
    let carry = buffer[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let result = '';
  for (let i = 0; i < buffer.length && buffer[i] === 0; i++) result += '1';
  for (let i = digits.length - 1; i >= 0; i--) result += BASE58_ALPHABET[digits[i]];
  return result;
}

async function fetchStakedSOL(walletAddress: string): Promise<number> {
  try {
    writeLog(`Fetching staked SOL for: ${walletAddress}`);

    const res = await fetch(RPC_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getProgramAccounts',
        params: [
          STAKE_PROGRAM_ID,
          {
            encoding: 'base64',
            filters: [
              {
                memcmp: {
                  offset: 124,
                  bytes: SOLANA_MOBILE_VOTE_ACCOUNT,
                },
              },
            ],
            dataSlice: { offset: 0, length: 200 },
          },
        ],
      }),
    });

    if (!res.ok) {
      writeLog(`✗ RPC request failed: ${res.status}`);
      return 0;
    }

    const json = await res.json() as any;
    const result = json?.result || [];
    writeLog(`✓ Retrieved ${result.length} stake accounts from validator`);

    let totalStaked = 0;

    for (const account of result) {
      try {
        const dataB64 = account.account.data[0];
        const buf = Buffer.from(dataB64, 'base64');

        // withdrawer pubkey at offset 44 (32 bytes)
        const withdrawerBytes = buf.slice(44, 76);
        const withdrawer = encodeBase58(withdrawerBytes);

        // Check if this stake account belongs to the wallet we're querying
        if (withdrawer !== walletAddress) continue;

        const stakeLamports = BigInt(account.account.lamports);
        const stakedSOL = Number(stakeLamports) / 1e9;

        if (stakedSOL <= 0) continue;

        totalStaked += stakedSOL;
      } catch {
        continue;
      }
    }

    const rounded = Math.round(totalStaked * 1e9) / 1e9;
    writeLog(`✓ Total staked SOL: ${rounded}`);
    return rounded;

  } catch (error) {
    writeLog(`✗ Error fetching staked SOL: ${error}`);
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
    return res.status(400).json({ error: 'Wallet address required', stakedSOL: 0 });
  }

  if (!HELIUS_API_KEY) {
    return res.status(500).json({ error: 'Server configuration error', stakedSOL: 0 });
  }

  try {
    const stakedSOL = await fetchStakedSOL(address);
    return res.status(200).json({ stakedSOL });
  } catch (error) {
    return res.status(500).json({ 
      error: 'Failed to fetch staked SOL',
      details: String(error),
      stakedSOL: 0
    });
  }
}