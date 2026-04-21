const { buildRebalancePlan } = require('../../src/ingest/subscriptionManager');

const pair = (key) => ({ pairKey: key, count: 10 });

describe('buildRebalancePlan', () => {
  it('returns empty plan when nothing changes', () => {
    const plan = buildRebalancePlan({
      topKPairs: [pair('A'), pair('B')],
      subscribedKeys: new Set(['A', 'B']),
      toSubscribe: [],
      toUnsubscribe: [],
    });
    expect(plan.subscribe).toEqual([]);
    expect(plan.unsubscribe).toEqual([]);
  });

  it('includes pairs flagged for subscription by hysteresis', () => {
    const plan = buildRebalancePlan({
      topKPairs: [pair('A'), pair('B'), pair('C')],
      subscribedKeys: new Set(['A', 'B']),
      toSubscribe: ['C'],
      toUnsubscribe: [],
    });
    expect(plan.subscribe).toEqual(['C']);
    expect(plan.unsubscribe).toEqual([]);
  });

  it('includes pairs flagged for unsubscription by hysteresis', () => {
    const plan = buildRebalancePlan({
      topKPairs: [pair('A')],
      subscribedKeys: new Set(['A', 'B']),
      toSubscribe: [],
      toUnsubscribe: ['B'],
    });
    expect(plan.unsubscribe).toEqual(['B']);
    expect(plan.subscribe).toEqual([]);
  });

  it('never subscribes a pair that is already subscribed', () => {
    const plan = buildRebalancePlan({
      topKPairs: [pair('A')],
      subscribedKeys: new Set(['A']),
      toSubscribe: ['A'], // hysteresis says subscribe but already subscribed
      toUnsubscribe: [],
    });
    expect(plan.subscribe).toEqual([]);
  });

  it('never unsubscribes a pair that is not currently subscribed', () => {
    const plan = buildRebalancePlan({
      topKPairs: [],
      subscribedKeys: new Set(['A']),
      toSubscribe: [],
      toUnsubscribe: ['B'], // hysteresis says unsubscribe but B not subscribed
    });
    expect(plan.unsubscribe).toEqual([]);
  });
});
