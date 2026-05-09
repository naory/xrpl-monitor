import { Box, Typography } from '@mui/material';

function fmt(n, decimals = 2) {
  if (n == null || isNaN(n)) return '—';
  const f = parseFloat(n);
  if (f >= 1e9)  return `${(f / 1e9).toFixed(decimals)}B`;
  if (f >= 1e6)  return `${(f / 1e6).toFixed(decimals)}M`;
  if (f >= 1000) return `${(f / 1000).toFixed(1)}K`;
  return f.toFixed(decimals);
}

function ammLabel(pool) {
  if (pool.pairKey) {
    const [left, right = ''] = pool.pairKey.split('~');
    const sym = (side) => side.split('|')[0];
    return `${sym(left)} / ${sym(right)}`;
  }
  return pool.ammAccount?.slice(0, 8) ?? '—';
}

export function AmmCard({ pool }) {
  const { volume, xrpTvl, tokenTvl, fee } = pool;
  const label = ammLabel(pool);
  const feePct = fee != null ? (fee / 1000).toFixed(2) : null;

  return (
    <Box
      sx={{
        p: 1.5,
        borderRadius: 2,
        bgcolor: 'background.paper',
        border: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
        minWidth: 0,
      }}
    >
      {/* Header: pair + fee */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: 'primary.main', fontFamily: 'JetBrains Mono', letterSpacing: 1 }}>
          {label}
        </Typography>
        {feePct != null && (
          <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', fontFamily: 'JetBrains Mono' }}>
            fee {feePct}%
          </Typography>
        )}
      </Box>

      {/* TVL row */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Typography sx={{ fontSize: '0.6rem', color: 'text.secondary', fontFamily: 'JetBrains Mono' }}>
          TVL
        </Typography>
        <Typography sx={{ fontSize: '0.65rem', color: 'text.primary', fontFamily: 'JetBrains Mono' }}>
          {xrpTvl != null ? `${fmt(xrpTvl)} XRP` : '—'}
          {tokenTvl != null ? ` · ${fmt(tokenTvl)}` : ''}
        </Typography>
      </Box>

      {/* Volume row */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Typography sx={{ fontSize: '0.6rem', color: 'text.secondary', fontFamily: 'JetBrains Mono' }}>
          VOL
        </Typography>
        <Typography sx={{ fontSize: '0.65rem', color: volume > 0 ? '#00e676' : 'text.disabled', fontFamily: 'JetBrains Mono', fontWeight: volume > 0 ? 700 : 400 }}>
          {volume != null ? `${fmt(volume)} XRP` : '—'}
        </Typography>
      </Box>

      {/* AMM account (truncated) */}
      <Typography sx={{ fontSize: '0.55rem', color: 'text.disabled', fontFamily: 'JetBrains Mono', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {pool.ammAccount}
      </Typography>
    </Box>
  );
}
