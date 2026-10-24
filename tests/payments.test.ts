import { describe, it, expect } from 'vitest';
import { verifyPayment, MEMO_PROGRAM, type Invoice } from '../lib/payments';
import { canonical, hash, redact } from '../lib/security';
const invoice: Invoice = {
  id: 'invoice_test',
  workspace_id: 'demo',
  payer: 'payer',
  recipient: 'recipient',
  lamports: 10000000,
  credits: 100,
  network: 'devnet',
  created_at: '2026-10-24T12:00:00Z',
  expires_at: '2026-10-24T12:30:00Z',
};
const genesis = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
function transaction() {
  return {
    blockTime: Math.floor(new Date('2026-10-24T12:01:00Z').getTime() / 1000),
    meta: { err: null },
    transaction: {
      message: {
        accountKeys: [{ pubkey: 'payer', signer: true }],
        instructions: [
          {
            programId: '11111111111111111111111111111111',
            parsed: {
              type: 'transfer',
              info: { source: 'payer', destination: 'recipient', lamports: 10000000 },
            },
          },
          { programId: MEMO_PROGRAM, parsed: 'relay:invoice_test:demo' },
        ],
      },
    },
  };
}
describe('finalized devnet payment verification', () => {
  it('accepts the exact transfer, signer and workspace invoice', () =>
    expect(verifyPayment(invoice, genesis, transaction())).toBe(true));
  it('rejects mainnet or a different network', () =>
    expect(() => verifyPayment(invoice, 'mainnet', transaction())).toThrow('devnet'));
  it('rejects failed and absent transactions', () => {
    const t = transaction();
    t.meta.err = {} as any;
    expect(() => verifyPayment(invoice, genesis, t)).toThrow();
    expect(() => verifyPayment(invoice, genesis, null)).toThrow();
  });
  it('rejects a wrong recipient, amount, payer, signer and workspace memo', () => {
    for (const field of ['destination', 'source', 'lamports']) {
      const t = transaction();
      (t.transaction.message.instructions[0].parsed as any).info[field] =
        field === 'lamports' ? 1 : 'other';
      expect(() => verifyPayment(invoice, genesis, t)).toThrow();
    }
    const t = transaction();
    t.transaction.message.accountKeys[0].signer = false;
    expect(() => verifyPayment(invoice, genesis, t)).toThrow('sign');
    const m = transaction();
    m.transaction.message.instructions[1].parsed = 'relay:invoice_test:other';
    expect(() => verifyPayment(invoice, genesis, m)).toThrow('workspace');
  });
  it('rejects payments outside the invoice time window and duplicate matching transfers', () => {
    const t = transaction();
    t.blockTime += 3600;
    expect(() => verifyPayment(invoice, genesis, t)).toThrow('window');
    const d = transaction();
    d.transaction.message.instructions.push(d.transaction.message.instructions[0]);
    expect(() => verifyPayment(invoice, genesis, d)).toThrow('amount');
  });
});
describe('trace security', () => {
  it('hashes semantic content independently of object key order', () =>
    expect(hash({ a: 1, b: 2 })).toBe(hash({ b: 2, a: 1 })));
  it('redacts credentials, encoded files, and contact addresses', () => {
    process.env.MUSE_API_KEY = 'very-secret-example';
    const text = JSON.stringify(
      redact({
        apiKey: 'abc',
        base64: 'raw',
        email: 'a@b.co',
        nested: { content: 'Bearer abc a@b.co very-secret-example' },
      }),
    );
    expect(text).not.toContain('very-secret-example');
    expect(text).not.toContain('a@b.co');
    expect(text).not.toContain('raw');
    delete process.env.MUSE_API_KEY;
  });
});
