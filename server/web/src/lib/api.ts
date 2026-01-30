/**
 * API client for the Unbrowse Skill Index.
 *
 * Free: search, summary
 * Paid: download (x402 Solana USDC via Phantom)
 */

export interface SkillSummary {
  id: string;
  service: string;
  slug: string;
  baseUrl: string;
  authMethodType: string;
  endpointCount: number;
  downloadCount: number;
  tags: string[];
  creatorWallet: string;
  creatorAlias?: string;
  updatedAt: string;
}

export interface SkillDetail extends SkillSummary {
  endpoints: { method: string; path: string }[];
}

export interface SkillPackage {
  id: string;
  service: string;
  baseUrl: string;
  authMethodType: string;
  endpoints: { method: string; path: string; description?: string }[];
  skillMd: string;
  apiTemplate: string;
}

export interface SearchResult {
  skills: SkillSummary[];
  total: number;
}

/** Search skills (free). */
export async function searchSkills(query: string, limit = 20): Promise<SearchResult> {
  const url = new URL("/skills/search", window.location.origin);
  if (query) url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));

  const resp = await fetch(url.toString());
  if (!resp.ok) throw new Error(`Search failed: ${resp.status}`);
  return resp.json();
}

/** Get skill summary with endpoints (free). */
export async function getSkillSummary(id: string): Promise<SkillDetail> {
  const resp = await fetch(`/skills/${encodeURIComponent(id)}/summary`);
  if (!resp.ok) throw new Error(`Summary failed: ${resp.status}`);
  return resp.json();
}

/**
 * Download a skill package (x402 payment via Phantom wallet).
 *
 * Flow:
 * 1. GET /skills/:id/download → 402 with payment requirements
 * 2. Build Solana transaction from requirements
 * 3. Sign with Phantom
 * 4. Retry with X-Payment header
 */
export async function downloadSkill(
  id: string,
  signTransaction: (tx: any) => Promise<any>,
  publicKey: string,
): Promise<SkillPackage> {
  // Step 1: Initial request — expect 402 (or 200 in dev mode)
  const resp = await fetch(`/skills/${encodeURIComponent(id)}/download`);

  if (resp.ok) {
    return resp.json();
  }

  if (resp.status !== 402) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Download failed (${resp.status}): ${text}`);
  }

  // Step 2: Parse payment requirements
  const paymentReq = await resp.json();
  const accepts = paymentReq?.accepts?.[0];
  if (!accepts) throw new Error("Invalid 402 response");

  // Step 3: Build + sign transaction
  const paymentData = await buildPaymentTransaction(accepts, signTransaction, publicKey);

  // Step 4: Retry with payment
  const retryResp = await fetch(`/skills/${encodeURIComponent(id)}/download`, {
    headers: { "X-Payment": paymentData },
  });

  if (!retryResp.ok) {
    const text = await retryResp.text().catch(() => "");
    throw new Error(`Payment failed (${retryResp.status}): ${text}`);
  }

  return retryResp.json();
}

/**
 * Build a Solana x402 payment transaction using dynamic imports.
 * This keeps @solana/web3.js out of the initial bundle.
 */
async function buildPaymentTransaction(
  accepts: {
    maxAmountRequired: string;
    payTo: string;
    asset: string;
    network: string;
    extra?: { feePayer?: string; programId?: string };
  },
  signTransaction: (tx: any) => Promise<any>,
  payerPublicKey: string,
): Promise<string> {
  // Dynamic import to avoid bundling @solana/web3.js upfront
  const {
    Connection,
    PublicKey,
    Transaction,
    TransactionInstruction,
  } = await import("@solana/web3.js");
  const { getAssociatedTokenAddress, createTransferInstruction } =
    await import("@solana/spl-token");

  const isDevnet = accepts.network?.includes("devnet");
  const rpcUrl = isDevnet
    ? "https://api.devnet.solana.com"
    : "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");

  const amount = BigInt(accepts.maxAmountRequired);
  const usdcMint = new PublicKey(accepts.asset);
  const recipient = new PublicKey(accepts.payTo);
  const payer = new PublicKey(payerPublicKey);
  const programId = new PublicKey(
    accepts.extra?.programId ?? "5g8XvMcpWEgHitW7abiYTr1u8sDasePLQnrebQyCLPvY",
  );

  // Token accounts
  const payerTokenAccount = await getAssociatedTokenAddress(usdcMint, payer);
  const recipientTokenAccount = await getAssociatedTokenAddress(usdcMint, recipient);

  // Nonce
  const nonce = BigInt(Date.now());

  // verify_payment instruction: [0x00, amount(u64 LE), nonce(u64 LE)]
  const verifyData = new Uint8Array(17);
  const verifyView = new DataView(verifyData.buffer);
  verifyData[0] = 0;
  verifyView.setBigUint64(1, amount, true);
  verifyView.setBigUint64(9, nonce, true);

  const verifyIx = new TransactionInstruction({
    programId,
    keys: [{ pubkey: payer, isSigner: true, isWritable: false }],
    data: Buffer.from(verifyData),
  });

  // SPL token transfer
  const transferIx = createTransferInstruction(
    payerTokenAccount,
    recipientTokenAccount,
    payer,
    Number(amount),
  );

  // settle_payment instruction: [0x01, nonce(u64 LE)]
  const settleData = new Uint8Array(9);
  const settleView = new DataView(settleData.buffer);
  settleData[0] = 1;
  settleView.setBigUint64(1, nonce, true);

  const settleIx = new TransactionInstruction({
    programId,
    keys: [{ pubkey: payer, isSigner: true, isWritable: false }],
    data: Buffer.from(settleData),
  });

  // Build transaction
  const tx = new Transaction();
  tx.add(verifyIx, transferIx, settleIx);

  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer;

  // Sign with Phantom
  const signedTx = await signTransaction(tx);

  // Encode as X-Payment header
  const payload = {
    transaction: Buffer.from(signedTx.serialize()).toString("base64"),
  };

  return btoa(JSON.stringify(payload));
}
