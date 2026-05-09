// ============================================================================
// TYPES
// ============================================================================
export interface OpportunityDApp {
  id: string;
  image: string;
  name: string;
  about: string;
  potentialRewards: string[];
  requiredCapital: string;
  status: 'Active' | 'Ended';
  date?: string;
  twitter?: string;
}

// ============================================================================
// HARDCODED OPPORTUNITIES
// ============================================================================
const OPPORTUNITIES: OpportunityDApp[] = [
  {
    id: 'colony',
    image: 'https://tracktivity-notifications.vercel.app/public/images/colony.png',
    name: 'Colony',
    about: 'Colony is a fully onchain idle resource trading strategy game...',
    potentialRewards: ['SOL'],
    requiredCapital: '0.1 SOL',
    status: 'Active',
    date: 'Until Feb 28, 2025',
    twitter: 'https://x.com/colonygameio',
  },
  // Add more opportunities here manually
];

// ============================================================================
// LOGGING
// ============================================================================
function writeLog(message: string): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

// ============================================================================
// HANDLER
// ============================================================================
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

  try {
    writeLog(`✓ Fetched ${OPPORTUNITIES.length} opportunities`);
    
    return res.status(200).json({
      opportunities: OPPORTUNITIES,
      total: OPPORTUNITIES.length,
    });
  } catch (error) {
    writeLog(`✗ Error fetching opportunities: ${error}`);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: String(error)
    });
  }
}