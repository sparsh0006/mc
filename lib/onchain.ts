// lib/onchain.ts
// Monad on-chain integration for transparent, verifiable records

const MONAD_RPC = process.env.MONAD_RPC_URL || "https://testnet-rpc.monad.xyz";
const CHAIN_ID = parseInt(process.env.MONAD_CHAIN_ID || "10143");

interface OnChainRecord {
  type: "FIGHT_VERDICT" | "TRIAL_VERDICT" | "TOURNAMENT_RESULT" | "AGENT_BAN" | "APPEAL_FILED";
  data: Record<string, any>;
  timestamp: number;
}

/**
 * Post a record hash to Monad for transparency.
 * In production, this calls a deployed smart contract.
 * For now, we use a simple self-transfer with calldata encoding.
 */
export async function postToChain(record: OnChainRecord): Promise<string | null> {
  const privateKey = process.env.MONAD_PRIVATE_KEY;
  const walletAddress = process.env.MONAD_WALLET_ADDRESS;

  if (!privateKey || !walletAddress) {
    console.warn("Monad keys not configured — skipping on-chain post");
    return null;
  }

  try {
    // Encode the record as hex calldata
    const recordJson = JSON.stringify(record);
    const hexData = "0x" + Buffer.from(recordJson).toString("hex");

    // Build transaction
    const nonce = await rpcCall("eth_getTransactionCount", [walletAddress, "latest"]);
    const gasPrice = await rpcCall("eth_gasPrice", []);

    const tx = {
      from: walletAddress,
      to: walletAddress, // Self-transfer with data
      value: "0x0",
      data: hexData,
      nonce,
      gasPrice,
      gas: "0x" + Math.min(Math.max(hexData.length * 8, 21000), 500000).toString(16),
      chainId: "0x" + CHAIN_ID.toString(16),
    };

    // Sign and send (simplified — in production use ethers.js or viem)
    const txHash = await rpcCall("eth_sendTransaction", [tx]);

    console.log(`On-chain record posted: ${txHash}`);
    return txHash;
  } catch (error) {
    console.error("Failed to post on-chain:", error);
    return null;
  }
}

/**
 * Create a verifiable hash of fight/trial data
 */
export function createRecordHash(data: Record<string, any>): string {
  const json = JSON.stringify(data, Object.keys(data).sort());
  // Simple hash for verification (in production use keccak256)
  let hash = 0;
  for (let i = 0; i < json.length; i++) {
    const char = json.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return "0x" + Math.abs(hash).toString(16).padStart(64, "0");
}

/**
 * Post a fight verdict on-chain
 */
export async function postFightVerdict(fightData: {
  fightId: string;
  topic: string;
  agentA: string;
  agentB: string;
  winnerId: string;
  totalScoreA: number;
  totalScoreB: number;
  rounds: number;
}): Promise<string | null> {
  return postToChain({
    type: "FIGHT_VERDICT",
    data: {
      ...fightData,
      hash: createRecordHash(fightData),
    },
    timestamp: Date.now(),
  });
}

/**
 * Post a trial verdict on-chain
 */
export async function postTrialVerdict(trialData: {
  trialId: string;
  accusedId: string;
  accusedName: string;
  violation: string;
  verdict: string;
  penalty: string;
  guiltyVotes: number;
  innocentVotes: number;
}): Promise<string | null> {
  return postToChain({
    type: "TRIAL_VERDICT",
    data: {
      ...trialData,
      hash: createRecordHash(trialData),
    },
    timestamp: Date.now(),
  });
}

/**
 * Post a tournament result on-chain
 */
export async function postTournamentResult(tournamentData: {
  tournamentId: string;
  name: string;
  winnerId: string;
  winnerName: string;
  prizeUsdc: number;
  entrants: number;
}): Promise<string | null> {
  return postToChain({
    type: "TOURNAMENT_RESULT",
    data: {
      ...tournamentData,
      hash: createRecordHash(tournamentData),
    },
    timestamp: Date.now(),
  });
}

/**
 * Low-level JSON-RPC call to Monad
 */
async function rpcCall(method: string, params: any[]): Promise<any> {
  const response = await fetch(MONAD_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(`RPC error: ${data.error.message}`);
  return data.result;
}

/**
 * Verify a record exists on-chain
 */
export async function verifyOnChain(txHash: string): Promise<{
  exists: boolean;
  data?: OnChainRecord;
}> {
  try {
    const tx = await rpcCall("eth_getTransactionByHash", [txHash]);
    if (!tx || !tx.input || tx.input === "0x") {
      return { exists: false };
    }

    const dataHex = tx.input.slice(2);
    const jsonStr = Buffer.from(dataHex, "hex").toString("utf-8");
    const record = JSON.parse(jsonStr) as OnChainRecord;

    return { exists: true, data: record };
  } catch {
    return { exists: false };
  }
}