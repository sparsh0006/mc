// lib/onchain.ts
// Production-grade Monad integration using viem

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  stringToHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const MONAD_RPC = process.env.MONAD_RPC_URL!;
const PRIVATE_KEY = process.env.MONAD_PRIVATE_KEY as `0x${string}`;
const CHAIN_ID = Number(process.env.MONAD_CHAIN_ID || 10143);

if (!MONAD_RPC) throw new Error("MONAD_RPC_URL missing");

const account = PRIVATE_KEY
  ? privateKeyToAccount(PRIVATE_KEY)
  : null;

const publicClient = createPublicClient({
  transport: http(MONAD_RPC),
});

const walletClient =
  account &&
  createWalletClient({
    account,
    chain: {
      id: CHAIN_ID,
      name: "Monad Testnet",
      nativeCurrency: {
        name: "MON",
        symbol: "MON",
        decimals: 18,
      },
      rpcUrls: {
        default: { http: [MONAD_RPC] },
      },
    },
    transport: http(MONAD_RPC),
  });

interface OnChainRecord {
  type:
    | "FIGHT_VERDICT"
    | "TRIAL_VERDICT"
    | "TOURNAMENT_RESULT"
    | "AGENT_BAN"
    | "APPEAL_FILED";
  data: Record<string, any>;
  timestamp: number;
}

/**
 * Cryptographic keccak256 hash
 */
export function createRecordHash(
  data: Record<string, any>
): `0x${string}` {
  const sorted = JSON.stringify(data, Object.keys(data).sort());
  return keccak256(stringToHex(sorted));
}

/**
 * Post record on-chain (signed transaction)
 */
export async function postToChain(
  record: OnChainRecord
): Promise<`0x${string}` | null> {
  if (!walletClient || !account) {
    console.warn("⚠ On-chain disabled — missing private key");
    return null;
  }

  try {
    const json = JSON.stringify(record);
    const dataHex = stringToHex(json);

    const txHash = await walletClient.sendTransaction({
      account,
      to: account.address, // self-transfer anchor
      value: BigInt(0),
      data: dataHex,
    });

    console.log("✅ On-chain record posted:", txHash);
    return txHash;
  } catch (err) {
    console.error("❌ On-chain error:", err);
    return null;
  }
}

/**
 * Fight verdict
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
}) {
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
 * Trial verdict
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
}) {
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
 * Tournament result
 */
export async function postTournamentResult(tournamentData: {
  tournamentId: string;
  name: string;
  winnerId: string;
  winnerName: string;
  prizeUsdc: number;
  entrants: number;
}) {
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
 * Verify and decode stored JSON
 */
export async function verifyOnChain(txHash: `0x${string}`) {
  try {
    const tx = await publicClient.getTransaction({ hash: txHash });

    if (!tx || !tx.input || tx.input === "0x") {
      return { exists: false };
    }

    const jsonStr = Buffer.from(tx.input.slice(2), "hex").toString("utf8");
    const record = JSON.parse(jsonStr);

    return { exists: true, data: record };
  } catch {
    return { exists: false };
  }
}
