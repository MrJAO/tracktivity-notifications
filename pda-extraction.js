const axios = require("axios");

const API_KEY = "YOUR_HELIUS_API";

const PROGRAM_ID = "SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ";

// Wallet to check
const WALLET = "Paste an active wallet address to check first";

async function getPDAs() {
  try {
    const url = `https://api.helius.xyz/v0/addresses/${WALLET}/transactions?api-key=${API_KEY}`;

    const res = await axios.get(url);
    const txs = res.data;

    const foundPDAs = new Set();

    for (const tx of txs) {
      // Look at instructions
      for (const ix of tx.instructions || []) {
        if (ix.programId === PROGRAM_ID) {

          // This is the key part
          const accounts = ix.accounts;

          if (accounts && accounts.length > 0) {
            const userStake = accounts[0]; // usually first account
            foundPDAs.add(userStake);
          }
        }
      }

      // inner instructions (important)
      for (const inner of tx.innerInstructions || []) {
        for (const ix of inner.instructions || []) {
          if (ix.programId === PROGRAM_ID) {
            const accounts = ix.accounts;

            if (accounts && accounts.length > 0) {
              const userStake = accounts[0];
              foundPDAs.add(userStake);
            }
          }
        }
      }
    }

    console.log("🎯 Found PDAs:");
    console.log([...foundPDAs]);

  } catch (err) {
    console.error(err.message);
  }
}

getPDAs();
