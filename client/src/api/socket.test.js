import { parseWsMessage } from './socket';

describe('parseWsMessage', () => {
  it('parses a fill envelope', () => {
    const envelope = JSON.stringify({
      channel: 'fills',
      raw: JSON.stringify({ type: 'fill', data: { txHash: 'ABC', pairKey: 'X~Y' } }),
    });
    const msg = parseWsMessage(envelope);
    expect(msg.type).toBe('fill');
    expect(msg.data.txHash).toBe('ABC');
  });

  it('parses a topk:changed envelope', () => {
    const envelope = JSON.stringify({
      channel: 'topk:changed',
      raw: JSON.stringify({ type: 'topk:changed', data: { pairs: [{ pairKey: 'A~B' }], timestamp: 123 } }),
    });
    const msg = parseWsMessage(envelope);
    expect(msg.type).toBe('topk:changed');
    expect(msg.data.pairs).toHaveLength(1);
  });

  it('returns null for malformed outer JSON', () => {
    expect(parseWsMessage('not-json')).toBeNull();
  });

  it('returns null when inner raw is not valid JSON', () => {
    const envelope = JSON.stringify({ channel: 'fills', raw: 'broken{' });
    expect(parseWsMessage(envelope)).toBeNull();
  });

  it('returns null when envelope has no raw field', () => {
    expect(parseWsMessage(JSON.stringify({ channel: 'fills' }))).toBeNull();
  });
});
