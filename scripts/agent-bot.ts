import { createWalletClient, http, toHex, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import dotenv from "dotenv";

dotenv.config();

// --- AGENT CONFIGURATION ---
const TOURNAMENT_ID = "cmlputij0000810jcsl3ovzom"; // The ID you want to join
const ENTRY_FEE = "5"; // Amount in USDC
const API_URL = `http://localhost:3000/api/tournaments/${TOURNAMENT_ID}/join`;

// Monad Testnet Constants
const CHAIN_ID = 10143;
const USDC_ADDRESS = "0x534b2f3A21130d7a60830c2Df862319e593943A3"; 
const TREASURY = process.env.PAY_TO_ADDRESS as `0x${string}`;

// Setup Agent Wallet
const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as `0x${string}`);
const client = createWalletClient({
  account,
  chain: defineChain({
    id: CHAIN_ID,
    name: "Monad Testnet",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } }
  }),
  transport: http(),
});

async function main() {
  console.log(`🤖 Agent ${account.address} attempting to join...`);

  // 1. Construct the EIP-712 Typed Data (The "Cheque")
  const now = Math.floor(Date.now() / 1000);
  const value = BigInt(Math.floor(parseFloat(ENTRY_FEE) * 1_000_000)); // USDC has 6 decimals

  const domain = {
    name: "USDC", // Important: Monad Testnet USDC name
    version: "2",
    chainId: BigInt(CHAIN_ID),
    verifyingContract: USDC_ADDRESS as `0x${string}`,
  } as const;

  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  } as const;

  const message = {
    from: account.address,
    to: TREASURY,
    value,
    validAfter: BigInt(now - 60),    // Valid from 1 min ago
    validBefore: BigInt(now + 3600), // Valid for 1 hour
    nonce: toHex(crypto.getRandomValues(new Uint8Array(32))),
  } as const;

  console.log("✍️  Signing payment of $" + ENTRY_FEE + " USDC...");

  // 2. Sign the Data (Local Operation - No Gas)
  const signature = await client.signTypedData({
    domain,
    types,
    primaryType: "TransferWithAuthorization",
    message,
  });

  // 3. Package the Header
  const payload = {
    authorization: {
      from: message.from,
      to: message.to,
      value: message.value.toString(),
      validAfter: message.validAfter.toString(),
      validBefore: message.validBefore.toString(),
      nonce: message.nonce,
    },
    signature,
  };
  
  // Base64 Encode
  const xPaymentHeader = Buffer.from(JSON.stringify(payload)).toString("base64");

  // 4. Send HTTP Request
  console.log("🚀 Sending request to API...");
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.AGENT_API_KEY || "cmlpkgwn30001g5egoacvbyn8"}`,
      "X-Payment": xPaymentHeader, // <--- The magic header
    },
    body: JSON.stringify({}),
  });

  const data = await response.json();
  
  if (response.status === 200) {
    console.log("✅ SUCCESS! Agent joined the tournament.");
    console.log(data);
  } else {
    console.log("❌ FAILED:", response.status);
    console.log(data);
  }
}

main().catch(console.error);