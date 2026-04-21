const { Hysteresis } = require('../../src/ingest/hysteresis');

const PROMOTE = 3;
const DEMOTE  = 3;

function make() {
  return new Hysteresis({ promoteThreshold: PROMOTE, demoteThreshold: DEMOTE });
}

describe('Hysteresis — promotion', () => {
  it('does not promote a pair that appears fewer than threshold times', () => {
    const h = make();
    h.update(['A']);
    h.update(['A']);
    expect(h.update(['A']).toSubscribe).toEqual([]);
  });

  it('promotes a pair after exactly threshold consecutive appearances', () => {
    const h = make();
    h.update(['A']);
    h.update(['A']);
    h.update(['A']);
    const { toSubscribe } = h.update(['A']);
    expect(toSubscribe).toContain('A');
  });

  it('emits promotion only once', () => {
    const h = make();
    for (let i = 0; i < PROMOTE + 1; i++) h.update(['A']);
    const { toSubscribe } = h.update(['A']);
    expect(toSubscribe).toEqual([]);
  });

  it('resets promotion counter when pair leaves top-K before threshold', () => {
    const h = make();
    h.update(['A']);
    h.update(['A']);
    h.update([]);          // gap — counter resets
    h.update(['A']);
    h.update(['A']);
    const { toSubscribe } = h.update(['A']); // only 3 consecutive including this one — not yet
    expect(toSubscribe).toEqual([]);
  });
});

describe('Hysteresis — demotion', () => {
  function promoted() {
    const h = make();
    // Promote A
    for (let i = 0; i < PROMOTE + 1; i++) h.update(['A']);
    return h;
  }

  it('does not demote a pair that is absent fewer than threshold times', () => {
    const h = promoted();
    h.update([]);
    h.update([]);
    expect(h.update([]).toUnsubscribe).toEqual([]);
  });

  it('demotes a pair after exactly threshold consecutive absences', () => {
    const h = promoted();
    h.update([]);
    h.update([]);
    h.update([]);
    const { toUnsubscribe } = h.update([]);
    expect(toUnsubscribe).toContain('A');
  });

  it('emits demotion only once', () => {
    const h = promoted();
    for (let i = 0; i < DEMOTE + 2; i++) h.update([]);
    const { toUnsubscribe } = h.update([]);
    expect(toUnsubscribe).toEqual([]);
  });

  it('resets demotion counter when pair re-enters top-K', () => {
    const h = promoted();
    h.update([]);
    h.update([]);
    h.update(['A']); // re-enters — demotion counter resets
    h.update([]);
    h.update([]);
    expect(h.update([]).toUnsubscribe).toEqual([]);
  });

  it('does not attempt to demote a pair that was never promoted', () => {
    const h = make();
    for (let i = 0; i < DEMOTE + 2; i++) h.update([]);
    expect(h.update([]).toUnsubscribe).toEqual([]);
  });
});

describe('Hysteresis — multiple pairs', () => {
  it('tracks each pair independently', () => {
    const h = make();
    for (let i = 0; i < PROMOTE + 1; i++) h.update(['A', 'B']);
    // both promoted

    // DEMOTE calls sets counter to threshold; the next (const) call fires demotion
    for (let i = 0; i < DEMOTE; i++) h.update(['A']); // B absent
    const { toUnsubscribe } = h.update(['A']);
    expect(toUnsubscribe).toContain('B');
    expect(toUnsubscribe).not.toContain('A');
  });

  it('can promote and demote in the same update cycle', () => {
    const h = make();
    for (let i = 0; i < PROMOTE + 1; i++) h.update(['B']);
    // B promoted. Now run exactly PROMOTE calls with A only — each call simultaneously
    // advances A.consecutiveIn toward threshold and B.consecutiveOut toward threshold.
    // After PROMOTE calls both counters sit at PROMOTE; the next call fires both.
    for (let i = 0; i < PROMOTE; i++) h.update(['A']);
    const result = h.update(['A']); // A.consecutiveIn=PROMOTE, B.consecutiveOut=PROMOTE → fire
    expect(result.toSubscribe).toContain('A');
    expect(result.toUnsubscribe).toContain('B');
  });
});
