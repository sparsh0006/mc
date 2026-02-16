// lib/x402.ts
// x402 integration for Monad micropayments (stakes, appeals, tournament entries)

const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || "https://x402-facilitator.molandak.org";
const MONAD_NETWORK = process.env.MONAD_NETWORK || "eip155:10143";
const MONAD_USDC = process.env.MONAD_USDC_ADDRESS || "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const PAY_TO = process.env.PAY_TO_ADDRESS || "";

export interface PaymentRequirement {
  x402Version: number;
  scheme: string;
  network: string;
  payTo: string;
  price: string;
  asset: string;
  facilitatorUrl: string;
  resource: string;
  description: string;
}

export interface VerifyResult {
  isValid: boolean;
  payer?: string;
  amount?: string;
  txHash?: string;
}

export interface SettleResult {
  success: boolean;
  transaction?: string;
  errorReason?: string;
}

/**
 * Generate a 402 Payment Required response for an endpoint
 */
export function createPaymentRequirement(
  priceUsdc: string,
  resource: string,
  description: string
): PaymentRequirement {
  return {
    x402Version: 2,
    scheme: "exact",
    network: MONAD_NETWORK,
    payTo: PAY_TO,
    price: `$${priceUsdc}`,
    asset: MONAD_USDC,
    facilitatorUrl: FACILITATOR_URL,
    resource,
    description,
  };
}

/**
 * Verify an x402 payment from the X-Payment header
 */
export async function verifyPayment(
  paymentHeader: string,
  expectedAmount: string,
  resource: string
): Promise<VerifyResult> {
  try {
    const payloadStr = Buffer.from(paymentHeader, "base64").toString("utf-8");
    const payload = JSON.parse(payloadStr);

    const response = await fetch(`${FACILITATOR_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        x402Version: 2,
        payload: payload,
        resource: {
          url: resource,
          description: "MoltCourt payment",
          mimeType: "application/json",
        },
        accepted: {
          scheme: "exact",
          network: MONAD_NETWORK,
          amount: usdcToSmallestUnit(expectedAmount),
          asset: MONAD_USDC,
          payTo: PAY_TO,
          maxTimeoutSeconds: 300,
          extra: { name: "USDC", version: "2" },
        },
      }),
    });

    const data = await response.json();
    return {
      isValid: data.isValid === true,
      payer: payload?.authorization?.from,
      amount: expectedAmount,
    };
  } catch (error) {
    console.error("x402 verify error:", error);
    return { isValid: false };
  }
}

/**
 * Settle a verified payment on-chain via the facilitator
 */
export async function settlePayment(
  paymentHeader: string,
  expectedAmount: string,
  resource: string
): Promise<SettleResult> {
  try {
    const payloadStr = Buffer.from(paymentHeader, "base64").toString("utf-8");
    const payload = JSON.parse(payloadStr);

    const requestBody = {
      x402Version: 2,
      payload,
      resource: {
        url: resource,
        description: "MoltCourt payment settlement",
        mimeType: "application/json",
      },
      accepted: {
        scheme: "exact",
        network: MONAD_NETWORK,
        amount: usdcToSmallestUnit(expectedAmount),
        asset: MONAD_USDC,
        payTo: PAY_TO,
        maxTimeoutSeconds: 300,
        extra: { name: "USDC", version: "2" },
      },
    };

    const response = await fetch(`${FACILITATOR_URL}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    if (data.success && data.transaction) {
      return { success: true, transaction: data.transaction };
    }
    return { success: false, errorReason: data.errorReason || "Settlement failed" };
  } catch (error: any) {
    return { success: false, errorReason: error.message };
  }
}

/**
 * Check if facilitator supports our network
 */
export async function checkFacilitatorSupport(): Promise<boolean> {
  try {
    const response = await fetch(`${FACILITATOR_URL}/supported`);
    const data = await response.json();
    return data?.networks?.includes(MONAD_NETWORK) || true; // Assume supported
  } catch {
    return false;
  }
}

/**
 * Convert USDC decimal amount to smallest unit (6 decimals)
 */
function usdcToSmallestUnit(amount: string): string {
  const parsed = parseFloat(amount);
  return Math.floor(parsed * 1_000_000).toString();
}

/**
 * Middleware helper: extract and validate x402 payment from request
 */
export async function extractPayment(
  request: Request,
  requiredAmount: string,
  resource: string
): Promise<{ paid: boolean; txHash?: string; error?: string }> {
  const paymentHeader =
    request.headers.get("x-payment") ||
    request.headers.get("X-Payment");

  if (!paymentHeader) {
    return { paid: false, error: "No payment header" };
  }

  const verified = await verifyPayment(paymentHeader, requiredAmount, resource);
  if (!verified.isValid) {
    return { paid: false, error: "Payment verification failed" };
  }

  const settled = await settlePayment(paymentHeader, requiredAmount, resource);
  if (!settled.success) {
    return { paid: false, error: settled.errorReason || "Settlement failed" };
  }

  return { paid: true, txHash: settled.transaction };
}