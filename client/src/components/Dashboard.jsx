import { useState } from 'react';
import { Box, Paper, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { Leaderboard }  from './Leaderboard';
import { PairGrid }     from './PairGrid';
import { OrderBook }    from './OrderBook';
import { PriceChart }   from './PriceChart';

const panel = {
  p: 2,
  height: '100%',
  boxSizing: 'border-box',
  bgcolor: 'background.paper',
};

export function Dashboard() {
  const [window, setWindow] = useState('1h');
  const [mode, setMode]     = useState('iou'); // 'iou' | 'mpt'

  return (
    <Box
      sx={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: '280px 1fr 260px',
        gridTemplateRows: '1fr 240px',
        gap: 1.5,
        p: 1.5,
        minHeight: 0,
      }}
    >
      {/* Row 1 */}
      <Paper sx={{ ...panel, gridRow: 1, gridColumn: 1 }}>
        <Leaderboard window={window} onWindowChange={setWindow} mode={mode} />
      </Paper>

      <Paper sx={{ ...panel, gridRow: 1, gridColumn: 2, overflow: 'hidden' }}>
        {/* Mode toggle sits above the grid */}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
          <ToggleButtonGroup
            value={mode}
            exclusive
            size="small"
            onChange={(_, v) => v && setMode(v)}
            sx={{ height: 24 }}
          >
            <ToggleButton value="iou" sx={{ fontSize: '0.65rem', px: 1.5, py: 0 }}>IOUs</ToggleButton>
            <ToggleButton value="mpt" sx={{ fontSize: '0.65rem', px: 1.5, py: 0 }}>MPTs</ToggleButton>
          </ToggleButtonGroup>
        </Box>
        <Box sx={{ height: 'calc(100% - 32px)', overflow: 'hidden' }}>
          <PairGrid window={window} mode={mode} />
        </Box>
      </Paper>

      <Paper sx={{ ...panel, gridRow: 1, gridColumn: 3 }}>
        <OrderBook />
      </Paper>

      {/* Row 2 — full-width price chart */}
      <Paper sx={{ ...panel, gridRow: 2, gridColumn: '1 / -1' }}>
        <PriceChart />
      </Paper>
    </Box>
  );
}
