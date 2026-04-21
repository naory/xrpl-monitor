const { buildHealthReport, detectGap } = require('../../src/api/health');

describe('detectGap', () => {
  it('returns no gap when ledgers are close', () => {
    const result = detectGap({ lastKnownLedger: 90000000, currentLedger: 90000005, threshold: 10 });
    expect(result.hasGap).toBe(false);
    expect(result.gapSize).toBe(5);
  });

  it('returns gap when ledgers differ by more than threshold', () => {
    const result = detectGap({ lastKnownLedger: 90000000, currentLedger: 90000020, threshold: 10 });
    expect(result.hasGap).toBe(true);
    expect(result.gapSize).toBe(20);
  });

  it('returns no gap when lastKnownLedger is null (first boot)', () => {
    const result = detectGap({ lastKnownLedger: null, currentLedger: 90000000, threshold: 10 });
    expect(result.hasGap).toBe(false);
    expect(result.gapSize).toBe(0);
  });

  it('returns exact threshold as no gap', () => {
    const result = detectGap({ lastKnownLedger: 100, currentLedger: 110, threshold: 10 });
    expect(result.hasGap).toBe(false);
    expect(result.gapSize).toBe(10);
  });
});

describe('buildHealthReport', () => {
  const base = {
    xrplConnected: true,
    lastLedgerIndex: 90000005,
    lastKnownLedger: 90000000,
    currentLedger: 90000005,
    dbOk: true,
    redisOk: true,
    uptimeSeconds: 120,
  };

  it('reports ok when all systems healthy and no gap', () => {
    const report = buildHealthReport(base);
    expect(report.status).toBe('ok');
    expect(report.checks.xrpl.status).toBe('ok');
    expect(report.checks.database.status).toBe('ok');
    expect(report.checks.redis.status).toBe('ok');
    expect(report.checks.ledgerGap.hasGap).toBe(false);
  });

  it('reports degraded when XRPL is disconnected', () => {
    const report = buildHealthReport({ ...base, xrplConnected: false });
    expect(report.status).toBe('degraded');
    expect(report.checks.xrpl.status).toBe('error');
  });

  it('reports degraded when database is down', () => {
    const report = buildHealthReport({ ...base, dbOk: false });
    expect(report.status).toBe('degraded');
    expect(report.checks.database.status).toBe('error');
  });

  it('reports degraded when redis is down', () => {
    const report = buildHealthReport({ ...base, redisOk: false });
    expect(report.status).toBe('degraded');
    expect(report.checks.redis.status).toBe('error');
  });

  it('includes gap warning in report when gap detected', () => {
    const report = buildHealthReport({ ...base, lastKnownLedger: 89999900, currentLedger: 90000005 });
    expect(report.checks.ledgerGap.hasGap).toBe(true);
    expect(report.checks.ledgerGap.gapSize).toBeGreaterThan(10);
  });

  it('includes uptime and timestamp', () => {
    const report = buildHealthReport(base);
    expect(report.uptimeSeconds).toBe(120);
    expect(report.timestamp).toBeDefined();
  });
});
