import { useState } from 'react';
import { Box, Paper } from '@mui/material';
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
        <Leaderboard window={window} onWindowChange={setWindow} />
      </Paper>

      <Paper sx={{ ...panel, gridRow: 1, gridColumn: 2, overflow: 'hidden' }}>
        <PairGrid window={window} />
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
