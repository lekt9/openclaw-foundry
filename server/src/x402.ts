/**
 * Solana x402 Payment Protocol for the Unbrowse Skill Index
 *
 * Implements HTTP 402 Payment Required with USDC (SPL Token) on Solana.
 * Adapted from reverse-engineer/src/server/x402-payment.ts.
 *
 * 4-party payment split:
 *   Wallet 1 (2% + gas) → Fixed fee payer
 *   Wallet 2 (3%)       → Skill creator (indexer)
 *   Wallet 3 (30%)      → FDRY Treasury
 *   Wallet 4 (65%)      → Website owner (→ treasury until domain verification)
 */

import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const USDC_MINT = new PublicKey(
  process.env.USDC_MINT || "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", // Devnet USDC
);

const FDRY_TREASURY_WALLET = process.env.FDRY_TREASURY_WALLET
  ? new PublicKey(process.env.FDRY_TREASURY_WALLET)
  : null;

// x402 Payment Smart Contract
const X402_PROGRAM_ID = new PublicKey("5g8XvMcpWEgHitW7abiYTr1u8sDasePLQnrebQyCLPvY");

// Fixed fee payer wallet — always receives 2% + gas reimbursement
const WALLET_1_FIXED = new PublicKey("8XLmbY1XRiPzeVNRDe9FZWHeCYKZAzvgc1c4EhyKsvEy");

// Split percentages (must sum to 100%)
const WALLET_1_SPLIT_PCT = 2;
const CREATOR_SPLIT_PCT = 3;
const FDRY_TREASURY_SPLIT_PCT = 30;
const WEBSITE_OWNER_SPLIT_PCT = 65;

// Gas reimbursement in USDC lamports — added to Wallet 1's share
const GAS_REIMBURSEMENT_LAMPORTS = 2000n;

// Minimum payment enforced by the smart contract
const MIN_PAYMENT_LAMPORTS = 5000n;

// Pricing
const USDC_DECIMALS = 6;
const DOWNLOAD_PRICE_CENTS = parseFloat(process.env.DOWNLOAD_PRICE_CENTS ?? "1.0");

/** Convert cents to USDC lamports (6 decimals). 1 cent = $0.01 = 10000 lamports. */
function centsToUsdcLamports(cents: number): bigint {
  return BigInt(Math.floor(cents * 10000));
}

const DOWNLOAD_COST_LAMPORTS = centsToUsdcLamports(DOWNLOAD_PRICE_CENTS);

// ============================================================================
// TYPES
// ============================================================================

export interface VerificationResult {
  valid: boolean;
  signature?: string;
  payer?: string;
  totalAmount?: bigint;
  error?: string;
}

export interface PaymentSplitInfo {
  wallet1Fixed: string;
  wallet1Amount: bigint;
  creatorWallet: string | null;
  creatorAmount: bigint;
  fdryTreasuryWallet: string;
  fdryTreasuryAmount: bigint;
  websiteOwnerWallet: string | null;
  websiteOwnerAmount: bigint;
  totalAmount: bigint;
}

interface PaymentRequirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  outputSchema?: Record<string, unknown>;
  extra: Record<string, unknown>;
}

// ============================================================================
// SOLANA CONNECTION
// ============================================================================

const connection = new Connection(SOLANA_RPC_URL, "confirmed");

// ============================================================================
// INSTRUCTION DECODING
// ============================================================================

/** Decode x402 verify_payment instruction (opcode 0). */
function decodeVerifyPaymentInstruction(data: Buffer): { amount: bigint; nonce: bigint } | null {
  if (data.length < 17 || data[0] !== 0) return null;
  return {
    amount: data.readBigUInt64LE(1),
    nonce: data.readBigUInt64LE(9),
  };
}

/** Decode x402 settle_payment instruction (opcode 1). */
function decodeSettlePaymentInstruction(data: Buffer): { nonce: bigint } | null {
  if (data.length < 9 || data[0] !== 1) return null;
  return { nonce: data.readBigUInt64LE(1) };
}

// ============================================================================
// PAYMENT VERIFICATION
// ============================================================================

/**
 * Verify a payment transaction from the X-Payment header.
 * Supports x402 smart contract transactions with verify_payment + settle_payment.
 *
 * Following the reference: accepts expectedRecipients array for per-wallet verification.
 */
export async function verifyPayment(
  paymentHeader: string,
  expectedRecipients: Array<{ address: PublicKey; minAmount: bigint }>,
): Promise<VerificationResult> {
  try {
    // Decode base64 payment data
    const paymentData = JSON.parse(
      Buffer.from(paymentHeader, "base64").toString("utf-8"),
    );

    const { transaction: txBase64, signature } = paymentData;
    if (!txBase64) {
      return { valid: false, error: "Missing transaction in payment data" };
    }

    // Decode the transaction
    const txBuffer = Buffer.from(txBase64, "base64");
    let tx: Transaction | VersionedTransaction;

    try {
      // Try to parse as legacy transaction first (more common for our use case)
      tx = Transaction.from(txBuffer);
      console.log(`[x402 Verify] Parsed as legacy Transaction`);
    } catch (legacyError) {
      // Fall back to versioned transaction
      try {
        tx = VersionedTransaction.deserialize(txBuffer);
        console.log(`[x402 Verify] Parsed as VersionedTransaction`);
      } catch (versionedError) {
        console.log(`[x402 Verify] Failed to parse transaction: legacy=${legacyError}, versioned=${versionedError}`);
        return { valid: false, error: "Failed to decode transaction" };
      }
    }

    // Simulate the transaction to verify it's valid
    const simulation = await connection.simulateTransaction(tx as any);
    if (simulation.value.err) {
      console.log(`[x402 Verify] Simulation failed:`, JSON.stringify(simulation.value.err));
      console.log(`[x402 Verify] Simulation logs:`, simulation.value.logs);
      return {
        valid: false,
        error: `Transaction simulation failed: ${JSON.stringify(simulation.value.err)}`,
      };
    }

    console.log(`[x402 Verify] Simulation successful`);

    // Extract x402 program instructions
    let verifyPaymentAmount: bigint | null = null;
    let settlePaymentNonce: bigint | null = null;
    let hasX402Instructions = false;

    if (tx instanceof Transaction) {
      console.log(`[x402 Verify] Transaction has ${tx.instructions.length} instructions`);

      for (let i = 0; i < tx.instructions.length; i++) {
        const instruction = tx.instructions[i];
        const programIdStr = instruction.programId.toBase58();
        console.log(`[x402 Verify] Instruction ${i}: programId=${programIdStr}`);

        if (instruction.programId.equals(X402_PROGRAM_ID)) {
          hasX402Instructions = true;
          const data = Buffer.from(instruction.data);
          const opcode = data[0];

          if (opcode === 0) {
            const decoded = decodeVerifyPaymentInstruction(data);
            if (decoded) {
              verifyPaymentAmount = decoded.amount;
              console.log(`[x402 Verify] Found verify_payment: amount=${decoded.amount}, nonce=${decoded.nonce}`);
            }
          } else if (opcode === 1) {
            const decoded = decodeSettlePaymentInstruction(data);
            if (decoded) {
              settlePaymentNonce = decoded.nonce;
              console.log(`[x402 Verify] Found settle_payment: nonce=${decoded.nonce}`);
            }
          }
        }
      }
    } else {
      // VersionedTransaction — extract from compiled instructions
      console.log(`[x402 Verify] VersionedTransaction detected`);
      const message = tx.message;

      for (let i = 0; i < message.compiledInstructions.length; i++) {
        const ci = message.compiledInstructions[i];
        const programId = message.staticAccountKeys[ci.programIdIndex];
        console.log(`[x402 Verify] CompiledInstruction ${i}: programId=${programId?.toBase58()}`);

        if (programId?.equals(X402_PROGRAM_ID)) {
          hasX402Instructions = true;
          const data = Buffer.from(ci.data);
          const opcode = data[0];

          if (opcode === 0) {
            const decoded = decodeVerifyPaymentInstruction(data);
            if (decoded) {
              verifyPaymentAmount = decoded.amount;
              console.log(`[x402 Verify] Found verify_payment: amount=${decoded.amount}, nonce=${decoded.nonce}`);
            }
          } else if (opcode === 1) {
            const decoded = decodeSettlePaymentInstruction(data);
            if (decoded) {
              settlePaymentNonce = decoded.nonce;
              console.log(`[x402 Verify] Found settle_payment: nonce=${decoded.nonce}`);
            }
          }
        }
      }
    }

    // Verify we found the required x402 instructions
    if (!hasX402Instructions) {
      console.log(`[x402 Verify] ERROR: No x402 program instructions found`);
      return { valid: false, error: "No x402 payment instructions found in transaction" };
    }
    if (verifyPaymentAmount === null) {
      console.log(`[x402 Verify] ERROR: Missing verify_payment instruction`);
      return { valid: false, error: "Missing verify_payment instruction" };
    }
    if (settlePaymentNonce === null) {
      console.log(`[x402 Verify] ERROR: Missing settle_payment instruction`);
      return { valid: false, error: "Missing settle_payment instruction" };
    }

    // Verify the amount meets minimum requirements
    const totalExpected = expectedRecipients.reduce((sum, r) => sum + r.minAmount, 0n);
    console.log(`[x402 Verify] Payment amount: ${verifyPaymentAmount}, expected minimum: ${totalExpected}`);

    if (verifyPaymentAmount < totalExpected) {
      return {
        valid: false,
        error: `Insufficient payment amount: got ${verifyPaymentAmount}, expected ${totalExpected}`,
      };
    }

    console.log(`[x402 Verify] Payment amount verified: ${verifyPaymentAmount} >= ${totalExpected}`);

    // If we have a signature, verify the transaction was actually submitted
    if (signature) {
      try {
        const confirmation = await connection.getSignatureStatus(signature);
        if (!confirmation.value || confirmation.value.err) {
          return { valid: false, error: "Transaction not confirmed on chain" };
        }
      } catch {
        // Signature not found yet, that's okay — we verified via simulation
      }
    }

    // Submit the transaction if not already submitted
    let finalSignature = signature;
    if (!finalSignature) {
      try {
        if (tx instanceof VersionedTransaction) {
          finalSignature = await connection.sendTransaction(tx);
        } else {
          finalSignature = await connection.sendRawTransaction(tx.serialize());
        }

        console.log(`[x402 Verify] Transaction submitted: ${finalSignature}`);

        // Wait for confirmation
        await connection.confirmTransaction(finalSignature, "confirmed");
        console.log(`[x402 Verify] Transaction confirmed`);
      } catch (submitError: any) {
        console.log(`[x402 Verify] Transaction submission failed:`, submitError.message);
        return { valid: false, error: `Transaction submission failed: ${submitError.message}` };
      }
    }

    return {
      valid: true,
      signature: finalSignature,
      totalAmount: verifyPaymentAmount,
    };
  } catch (err: any) {
    console.log(`[x402 Verify] Error:`, err.message);
    return { valid: false, error: err.message || "Payment verification failed" };
  }
}

// ============================================================================
// PAYMENT SPLIT
// ============================================================================

/**
 * Calculate the 4-party payment split for a skill download.
 */
export function calculatePaymentSplit(
  totalAmount: bigint,
  creatorWallet: string | null,
): PaymentSplitInfo {
  const treasuryAddr = FDRY_TREASURY_WALLET?.toBase58() ?? WALLET_1_FIXED.toBase58();

  const baseWallet1 = (totalAmount * BigInt(WALLET_1_SPLIT_PCT)) / 100n;
  const wallet1Amount = baseWallet1 + GAS_REIMBURSEMENT_LAMPORTS;
  const creatorAmount = (totalAmount * BigInt(CREATOR_SPLIT_PCT)) / 100n;
  const fdryAmount = (totalAmount * BigInt(FDRY_TREASURY_SPLIT_PCT)) / 100n;
  const websiteOwnerAmount = totalAmount - wallet1Amount - creatorAmount - fdryAmount;

  return {
    wallet1Fixed: WALLET_1_FIXED.toBase58(),
    wallet1Amount,
    creatorWallet,
    creatorAmount,
    fdryTreasuryWallet: treasuryAddr,
    fdryTreasuryAmount: fdryAmount,
    websiteOwnerWallet: null, // No domain verification yet
    websiteOwnerAmount, // Goes to treasury
    totalAmount,
  };
}

// ============================================================================
// x402 RESPONSE
// ============================================================================

/**
 * Create an x402-compliant 402 response (per x402scan schema).
 * Standard format required by x402scan and compatible clients.
 */
export function createX402Response(resourceUrl: string, skillId?: string): Response {
  const isDevnet = SOLANA_RPC_URL.includes("devnet");
  const treasuryAddr = FDRY_TREASURY_WALLET?.toBase58() ?? WALLET_1_FIXED.toBase58();

  const accepts: PaymentRequirements = {
    scheme: "exact",
    network: isDevnet ? "solana-devnet" : "solana",
    maxAmountRequired: DOWNLOAD_COST_LAMPORTS.toString(),
    resource: resourceUrl,
    description: `Download skill package${skillId ? ` ${skillId}` : ""}`,
    mimeType: "application/json",
    payTo: treasuryAddr,
    maxTimeoutSeconds: 60,
    asset: USDC_MINT.toBase58(),
    outputSchema: {
      input: {
        type: "http",
        method: "GET",
      },
      output: {
        success: "boolean",
        id: "string",
        service: "string",
        skillMd: "string",
        apiTemplate: "string",
      },
    },
    extra: {
      feePayer: WALLET_1_FIXED.toBase58(),
      costCents: DOWNLOAD_PRICE_CENTS,
      costUsd: DOWNLOAD_PRICE_CENTS / 100,
      programId: X402_PROGRAM_ID.toBase58(),
      wallet1Fixed: WALLET_1_FIXED.toBase58(),
    },
  };

  return Response.json(
    { x402Version: 1, accepts: [accepts] },
    { status: 402 },
  );
}

// ============================================================================
// PAYMENT GATE
// ============================================================================

/**
 * x402 payment gate for skill downloads.
 *
 * Payment split (matches reference x402ExecuteMiddleware):
 * - Wallet 1 (2% + gas): FIXED fee payer
 * - Wallet 2 (3%):       Skill creator (indexer)
 * - Wallet 3 (30%):      FDRY Treasury
 * - Wallet 4 (65%):      Website owner (→ treasury if unclaimed)
 *
 * Unclaimed shares are consolidated into the FDRY Treasury recipient.
 *
 * Returns a 402 Response if payment is missing or invalid.
 * Returns null if payment is verified — caller should proceed with download.
 */
export async function handleDownloadPaymentGate(
  req: Request,
  skillId: string,
  creatorWallet: string | null,
): Promise<{ response: Response } | { response: null; signature: string; amount: bigint; splits: PaymentSplitInfo }> {
  // Dev mode: no treasury configured → downloads are free
  if (!FDRY_TREASURY_WALLET) {
    return { response: null, signature: "", amount: 0n, splits: calculatePaymentSplit(0n, null) };
  }

  const paymentHeader = req.headers.get("X-Payment");
  const url = new URL(req.url);
  const resourceUrl = `${url.origin}${url.pathname}`;

  // Calculate 4-party split upfront (needed for both 402 response and verification)
  const splitInfo = calculatePaymentSplit(DOWNLOAD_COST_LAMPORTS, creatorWallet);

  if (!paymentHeader) {
    return { response: createX402Response(resourceUrl, skillId) };
  }

  // Build expected recipients for 4-party split verification
  // Consolidate amounts to actual wallets (unclaimed shares go to FDRY Treasury)
  const expectedRecipients: Array<{ address: PublicKey; minAmount: bigint }> = [];

  // Wallet 1 (2% + gas) — ALWAYS fixed fee payer
  expectedRecipients.push({
    address: WALLET_1_FIXED,
    minAmount: splitInfo.wallet1Amount,
  });

  // Track how much goes to FDRY Treasury (base 30% + any unclaimed shares)
  let fdryAmount = splitInfo.fdryTreasuryAmount;

  // Wallet 2 (3%) — Creator/indexer
  if (splitInfo.creatorWallet) {
    expectedRecipients.push({
      address: new PublicKey(splitInfo.creatorWallet),
      minAmount: splitInfo.creatorAmount,
    });
  } else {
    // Unclaimed — add to FDRY Treasury
    fdryAmount += splitInfo.creatorAmount;
  }

  // Wallet 4 (65%) — Website owner
  if (splitInfo.websiteOwnerWallet) {
    expectedRecipients.push({
      address: new PublicKey(splitInfo.websiteOwnerWallet),
      minAmount: splitInfo.websiteOwnerAmount,
    });
  } else {
    // Unclaimed — add to FDRY Treasury
    fdryAmount += splitInfo.websiteOwnerAmount;
  }

  // Wallet 3 (30%) + any unclaimed shares → FDRY Treasury
  expectedRecipients.push({
    address: FDRY_TREASURY_WALLET,
    minAmount: fdryAmount,
  });

  console.log(`[x402] Expected recipients: ${expectedRecipients.map(r => ({
    to: r.address.toBase58().slice(0, 8) + "...",
    min: r.minAmount.toString(),
  })).map(r => JSON.stringify(r)).join(", ")}`);

  // Verify payment against expected recipients
  const result = await verifyPayment(paymentHeader, expectedRecipients);
  if (!result.valid) {
    console.log(`[x402] Payment verification failed: ${result.error}`);
    const errResponse = createX402Response(resourceUrl, skillId);
    const body = await errResponse.json();
    (body as any).error = "invalid_payment";
    (body as any).message = result.error;
    return {
      response: Response.json(body, { status: 402 }),
    };
  }

  const amount = result.totalAmount ?? DOWNLOAD_COST_LAMPORTS;
  // Recalculate splits with actual paid amount (may be >= expected)
  const finalSplits = calculatePaymentSplit(amount, creatorWallet);

  return {
    response: null,
    signature: result.signature ?? "",
    amount,
    splits: finalSplits,
  };
}

/** Check if x402 payments are enabled (treasury wallet configured). */
export function isX402Enabled(): boolean {
  return FDRY_TREASURY_WALLET !== null;
}

/** Get download price in USD. */
export function getDownloadPriceUsd(): number {
  return DOWNLOAD_PRICE_CENTS / 100;
}
