const DEFAULT_PROMOTE_THRESHOLD = 3;
const DEFAULT_DEMOTE_THRESHOLD  = 3;
const MAX_CONSECUTIVE_OUT = 50; // evict unpromoted pairs that have been absent this long

class Hysteresis {
  constructor({ promoteThreshold = DEFAULT_PROMOTE_THRESHOLD, demoteThreshold = DEFAULT_DEMOTE_THRESHOLD } = {}) {
    this.promoteThreshold = promoteThreshold;
    this.demoteThreshold  = demoteThreshold;
    // pairKey → { consecutiveIn, consecutiveOut, subscribed }
    this._state = new Map();
  }

  update(topKPairKeys) {
    const inTopK = new Set(topKPairKeys);
    const toSubscribe   = [];
    const toUnsubscribe = [];

    // Step 1 — evaluate on counters from the PREVIOUS cycle
    for (const [key, s] of this._state) {
      if (!s.subscribed && s.consecutiveIn >= this.promoteThreshold) {
        s.subscribed    = true;
        s.consecutiveIn = 0;
        toSubscribe.push(key);
      } else if (s.subscribed && s.consecutiveOut >= this.demoteThreshold) {
        s.subscribed     = false;
        s.consecutiveOut = 0;
        toUnsubscribe.push(key);
      }
    }

    // Step 2 — update counters for all tracked pairs
    for (const [key, s] of this._state) {
      if (inTopK.has(key)) {
        s.consecutiveIn  += 1;
        s.consecutiveOut  = 0;
      } else {
        s.consecutiveOut += 1;
        s.consecutiveIn   = 0;
      }
    }

    // Step 3 — initialise pairs newly seen in top-K (after update so they start at 1)
    for (const key of inTopK) {
      if (!this._state.has(key)) {
        this._state.set(key, { consecutiveIn: 1, consecutiveOut: 0, subscribed: false });
      }
    }

    // Evict unpromoted pairs that have been absent too long to avoid unbounded state growth
    for (const [key, s] of this._state) {
      if (!s.subscribed && s.consecutiveOut > MAX_CONSECUTIVE_OUT) {
        this._state.delete(key);
      }
    }

    return { toSubscribe, toUnsubscribe };
  }
}

module.exports = { Hysteresis };
