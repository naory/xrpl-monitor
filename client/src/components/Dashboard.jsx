import { Box, Paper } from '@mui/material';
import { Leaderboard }   from './Leaderboard';
import { PairGrid }      from './PairGrid';
import { AmmGrid }       from './AmmGrid';
import { LedgerStats }   from './LedgerStats';
import { BridgeView }    from './BridgeView';
import { OrderBook }     from './OrderBook';
import { PriceChart }    from './PriceChart';

const panel = {
  p: 2,
  height: '100%',
  boxSizing: 'border-box',
  bgcolor: 'background.paper',
};

export function Dashboard({ mode, window }) {
  if (mode === 'ledger') {
    return (
      <Box sx={{ flex: 1, p: 1.5, minHeight: 0, overflow: 'hidden' }}>
        <LedgerStats window={window} />
      </Box>
    );
  }

  if (mode === 'bridge') {
    return (
      <Box sx={{ flex: 1, p: 1.5, minHeight: 0, overflow: 'auto', display: 'flex', justifyContent: 'center' }}>
        <BridgeView />
      </Box>
    );
  }

  const centrePanel = mode === 'amm'
    ? <AmmGrid window={window} />
    : <PairGrid window={window} mode={mode} />;

  return (
    <Box sx={{
      flex: 1,
      display: 'grid',
      gridTemplateColumns: '280px 1fr 260px',
      gridTemplateRows: '1fr 240px',
      gap: 1.5,
      p: 1.5,
      minHeight: 0,
    }}>
      <Paper sx={{ ...panel, gridRow: 1, gridColumn: 1 }}>
        <Leaderboard window={window} mode={mode} />
      </Paper>

      <Paper sx={{ ...panel, gridRow: 1, gridColumn: 2, overflow: 'hidden' }}>
        {centrePanel}
      </Paper>

      <Paper sx={{ ...panel, gridRow: 1, gridColumn: 3 }}>
        <OrderBook />
      </Paper>

      <Paper sx={{ ...panel, gridRow: 2, gridColumn: '1 / -1' }}>
        <PriceChart />
      </Paper>
    </Box>
  );
}
