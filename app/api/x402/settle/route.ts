// app/api/x402/settle/route.ts
import { NextRequest, NextResponse } from "next/server";
import { settlePayment } from "@/lib/x402";

export async function POST(req: NextRequest) {
  try {
    const { payment_header, amount, resource } = await req.json();

    if (!payment_header || !amount || !resource) {
      return NextResponse.json({ error: "payment_header, amount, and resource required" }, { status: 400 });
    }

    const result = await settlePayment(payment_header, amount, resource);

    return NextResponse.json({
      success: result.success,
      transaction: result.transaction,
      error: result.errorReason,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}