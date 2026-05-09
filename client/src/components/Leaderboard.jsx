import { Box, Typography, CircularProgress } from '@mui/material';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { useStats } from '../hooks/useStats';
import { useAmmStats } from '../hooks/useAmmStats';
import { useWsStore } from '../store/useWsStore';
import { aggregateByToken } from '../utils/pairs';

const PAIR_COLORS = ['#00e5ff', '#7c4dff', '#00e676', '#ffab40', '#ff4081', '#64ffda', '#ea80fc', '#82b1ff', '#ccff90', '#ff6d00'];

function fmtVol(n) {
  if (n >= 1e9)  return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toFixed(2);
}

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <Box sx={{ bgcolor: 'background.default', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 1, px: 1.5, py: 1 }}>
      <Typography variant="caption" display="block" color="primary.main" fontWeight={700}>{d.label}</Typography>
      <Typography variant="caption" display="block" color="text.secondary">
        Vol: {fmtVol(d.volume)} XRP
      </Typography>
      {d.issuerCount > 1 && (
        <Typography variant="caption" display="block" color="text.disabled">
          {d.issuerCount} issuers combined
        </Typography>
      )}
    </Box>
  );
};

function useLeaderboardData(mode, window) {
  const dex = useStats(window);
  const amm = useAmmStats(window);

  if (mode === 'amm') {
    const pools = amm.data?.pools ?? [];
    const chartData = pools
      .filter((p) => p.pairKey)
      .map((p) => {
        const [left, right = ''] = p.pairKey.split('~');
        const sym = (side) => side.split('|')[0];
        return { label: `${sym(left)}/${sym(right)}`, volume: parseFloat(p.volume) || 0, pairKey: p.pairKey, issuerCount: 1 };
      })
      .sort((a, b) => b.volume - a.volume);
    return { isLoading: amm.isLoading, isError: amm.isError, chartData, totalFills: null };
  }

  const chartData = aggregateByToken(dex.data?.volumeLeaderboard ?? [], mode).map((row) => ({
    ...row,
    label: row.issuerCount > 1 ? `${row.label} ×${row.issuerCount}` : row.label,
  }));
  return { isLoading: dex.isLoading, isError: dex.isError, chartData, totalFills: dex.data?.totalFills };
}

export function Leaderboard({ window, mode }) {
  const { isLoading, isError, chartData, totalFills } = useLeaderboardData(mode, window);
  const setSelectedPair = useWsStore((s) => s.setSelectedPair);
  const selectedPair    = useWsStore((s) => s.selectedPair);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
        <Typography variant="h6" sx={{ fontSize: '0.85rem', color: 'primary.main', textTransform: 'uppercase', letterSpacing: 2 }}>
          Volume Leaders
        </Typography>
      </Box>

      {isLoading && <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CircularProgress size={24} /></Box>}
      {isError && <Typography variant="caption" color="error">Failed to load stats</Typography>}

      {!isLoading && !isError && chartData.length === 0 && (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography variant="caption" color="text.secondary">No volume data yet…</Typography>
        </Box>
      )}

      {!isLoading && chartData.length > 0 && (
        <Box sx={{ flex: 1 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 0, right: 12, left: -8, bottom: 0 }}
              onClick={({ activePayload }) => {
                if (activePayload?.[0]) setSelectedPair(activePayload[0].payload.pairKey);
              }}
            >
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="label"
                width={90}
                tick={{ fill: '#9fa8da', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Bar dataKey="volume" radius={[0, 4, 4, 0]}>
                {chartData.map((entry, i) => (
                  <Cell
                    key={entry.pairKey}
                    fill={PAIR_COLORS[i % PAIR_COLORS.length]}
                    opacity={selectedPair && selectedPair !== entry.pairKey ? 0.35 : 1}
                    cursor="pointer"
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Box>
      )}

      {totalFills != null && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, opacity: 0.6 }}>
          {totalFills.toLocaleString()} fills all-time
        </Typography>
      )}
    </Box>
  );
}
