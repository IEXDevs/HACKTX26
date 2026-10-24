import { pool, tx } from './db';
import { HttpError } from './config';
import { id } from './security';
const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
export const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export type Invoice = {
  id: string;
  workspace_id: string;
  payer: string;
  recipient: string;
  lamports: string | number;
  credits: number;
  network: string;
  created_at: string;
  expires_at: string;
};
export function verifyPayment(invoice: Invoice, genesis: string, transaction: any) {
  if (genesis !== DEVNET_GENESIS || invoice.network !== 'devnet')
    throw new HttpError(400, 'Only Solana devnet is supported');
  if (!transaction || !transaction.meta || transaction.meta.err !== null)
    throw new HttpError(400, 'Transaction was not finalized successfully');
  const time = Number(transaction.blockTime) * 1000;
  if (
    !Number.isFinite(time) ||
    time < new Date(invoice.created_at).getTime() - 5000 ||
    time > new Date(invoice.expires_at).getTime()
  )
    throw new HttpError(400, 'Payment falls outside the invoice validity window');
  const message = transaction.transaction?.message;
  const signer = message?.accountKeys?.some(
    (k: any) => k.pubkey === invoice.payer && k.signer === true,
  );
  if (!signer) throw new HttpError(400, 'Invoice payer did not sign this transaction');
  const instructions = message.instructions || [];
  const transfers = instructions.filter(
    (i: any) =>
      i.programId === '11111111111111111111111111111111' &&
      i.parsed?.type === 'transfer' &&
      i.parsed.info.destination === invoice.recipient,
  );
  if (
    transfers.length !== 1 ||
    transfers[0].parsed.info.source !== invoice.payer ||
    BigInt(transfers[0].parsed.info.lamports) !== BigInt(invoice.lamports)
  )
    throw new HttpError(400, 'Recipient, payer or amount does not match this invoice');
  const memo = `relay:${invoice.id}:${invoice.workspace_id}`;
  if (!instructions.some((i: any) => i.programId === MEMO_PROGRAM && i.parsed === memo))
    throw new HttpError(400, 'Invoice/workspace memo is missing');
  return true;
}
export async function createInvoice(workspace: string, payer: string) {
  const recipient = process.env.SOLANA_RECIPIENT;
  if (!recipient || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(recipient))
    throw new HttpError(503, 'Devnet credits unavailable: configure a real SOLANA_RECIPIENT');
  if (payer === recipient) throw new HttpError(400, 'Invoice payer must differ from the recipient');
  const invoiceId = id('invoice');
  const result = await pool.query(
    "INSERT INTO credit_invoices(id,workspace_id,recipient,payer,lamports,credits,network,expires_at) VALUES($1,$2,$3,$4,10000000,100,'devnet',now()+interval '30 minutes') RETURNING *",
    [invoiceId, workspace, recipient, payer],
  );
  return {
    ...result.rows[0],
    memo: `relay:${invoiceId}:${workspace}`,
    notice: '100 TEST credits for 0.01 devnet SOL. No monetary value.',
  };
}
async function rpc(method: string, params: unknown[] = []) {
  const response = await fetch(process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new HttpError(503, 'Devnet RPC unavailable');
  const data = await response.json();
  if (data.error) throw new HttpError(400, 'Devnet RPC could not verify this payment');
  return data.result;
}
export async function creditPayment(workspace: string, invoiceId: string, signature: string) {
  const invoice = (
    await pool.query('SELECT * FROM credit_invoices WHERE id=$1 AND workspace_id=$2', [
      invoiceId,
      workspace,
    ])
  ).rows[0];
  if (!invoice) throw new HttpError(404, 'Invoice not found');
  if (invoice.status === 'credited') {
    if (invoice.signature !== signature)
      throw new HttpError(409, 'Invoice already settled with a different transaction');
    return { credited: true, replayed: true, credits: invoice.credits };
  }
  const [genesis, transaction] = await Promise.all([
    rpc('getGenesisHash'),
    rpc('getTransaction', [
      signature,
      { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0 },
    ]),
  ]);
  verifyPayment(invoice, genesis, transaction);
  return settleVerifiedPayment(workspace, invoiceId, signature);
}
export async function settleVerifiedPayment(
  workspace: string,
  invoiceId: string,
  signature: string,
) {
  // Internal only. The API calls creditPayment, never this settlement function.
  return tx(async (db) => {
    await db.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [workspace]);
    const current = (
      await db.query('SELECT * FROM credit_invoices WHERE id=$1 AND workspace_id=$2 FOR UPDATE', [
        invoiceId,
        workspace,
      ])
    ).rows[0];
    if (!current) throw new HttpError(404, 'Invoice not found');
    const prior = (
      await db.query('SELECT * FROM credit_ledger WHERE reference=$1', [
        'solana:devnet:' + signature,
      ])
    ).rows[0];
    if (prior) {
      if (current.signature !== signature || prior.workspace_id !== workspace)
        throw new HttpError(409, 'Transaction already credited to another invoice');
      return { credited: true, replayed: true, credits: current.credits };
    }
    if (current.status !== 'pending') throw new HttpError(409, 'Invoice already settled');
    await db.query("UPDATE credit_invoices SET status='credited',signature=$1 WHERE id=$2", [
      signature,
      invoiceId,
    ]);
    await db.query(
      'INSERT INTO credit_ledger(id,workspace_id,delta,reason,reference) VALUES($1,$2,$3,$4,$5)',
      [
        id('ledger'),
        workspace,
        current.credits,
        'Finalized Solana DEVNET payment · TEST credits',
        'solana:devnet:' + signature,
      ],
    );
    return { credited: true, replayed: false, credits: current.credits };
  });
}
