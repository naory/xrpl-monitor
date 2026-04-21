import { Box, Typography, ToggleButton, ToggleButtonGroup, CircularProgress } from '@mui/material';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { useStats } from '../hooks/useStats';
import { useWsStore } from '../store/useWsStore';

const WINDOWS = ['10m', '1h', '24h'];
const PAIR_COLORS = ['#00e5ff', '#7c4dff', '#00e676', '#ffab40', '#ff4081', '#64ffda', '#ea80fc', '#82b1ff', '#ccff90', '#ff6d00'];

function shortPair(pairKey) {
  const parts = pairKey.split('~');
  const side = (s) => s.split('|')[0];
  return `${side(parts[0])}/${side(parts[1] ?? '')}`;
}

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <Box sx={{ bgcolor: 'background.default', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 1, px: 1.5, py: 1 }}>
      <Typography variant="caption" display="block" color="primary.main" fontWeight={700}>{d.pairKey}</Typography>
      <Typography variant="caption" display="block" color="text.secondary">
        Volume: {parseFloat(d.volume).toFixed(2)}
      </Typography>
    </Box>
  );
};

export function Leaderboard({ window, onWindowChange }) {
  const { data, isLoading, isError } = useStats(window);
  const setSelectedPair = useWsStore((s) => s.setSelectedPair);
  const selectedPair    = useWsStore((s) => s.selectedPair);

  const chartData = (data?.volumeLeaderboard ?? []).map((p) => ({
    ...p,
    label: shortPair(p.pairKey),
  }));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
        <Typography variant="h6" sx={{ fontSize: '0.85rem', color: 'primary.main', textTransform: 'uppercase', letterSpacing: 2 }}>
          Volume Leaders
        </Typography>
        <ToggleButtonGroup
          value={window}
          exclusive
          size="small"
          onChange={(_, v) => v && onWindowChange(v)}
          sx={{ height: 24 }}
        >
          {WINDOWS.map((w) => (
            <ToggleButton key={w} value={w} sx={{ fontSize: '0.65rem', px: 1, py: 0 }}>
              {w}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
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
              margin={{ top: 0, right: 12, left: 0, bottom: 0 }}
              onClick={({ activePayload }) => {
                if (activePayload?.[0]) setSelectedPair(activePayload[0].payload.pairKey);
              }}
            >
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="label"
                width={56}
                tick={{ fill: '#9fa8da', fontSize: 11, fontFamily: 'JetBrains Mono' }}
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

      {data?.totalFills != null && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, opacity: 0.6 }}>
          {data.totalFills.toLocaleString()} fills all-time
        </Typography>
      )}
    </Box>
  );
}
