// app/api/x402/verify/route.ts
import { NextRequest, NextResponse } from "next/server";
import { verifyPayment } from "@/lib/x402";

export async function POST(req: NextRequest) {
  try {
    const { payment_header, amount, resource } = await req.json();

    if (!payment_header || !amount || !resource) {
      return NextResponse.json({ error: "payment_header, amount, and resource required" }, { status: 400 });
    }

    const result = await verifyPayment(payment_header, amount, resource);

    return NextResponse.json({
      valid: result.isValid,
      payer: result.payer,
      amount: result.amount,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}