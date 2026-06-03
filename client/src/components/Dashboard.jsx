import { Box, Paper } from '@mui/material';
import { Leaderboard }   from './Leaderboard';
import { PairGrid }      from './PairGrid';
import { AmmGrid }       from './AmmGrid';
import { LedgerStats }   from './LedgerStats';
import { BridgeView }    from './BridgeView';
import { XrpDemandView } from './XrpDemandView';
import { EscrowView }    from './EscrowView';
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

  if (mode === 'xrp-flow') {
    return (
      <Box sx={{ display: 'flex', flex: 1, gap: 1.5, p: 1.5, minHeight: 0, overflow: 'hidden' }}>
        <Box sx={{ flex: 1, minWidth: 0, overflow: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper' }}>
          <BridgeView />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, overflow: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper' }}>
          <XrpDemandView />
        </Box>
      </Box>
    );
  }

  if (mode === 'escrow-time') {
    return (
      <Box sx={{ display: 'flex', flex: 1, justifyContent: 'center', p: 1.5, minHeight: 0, overflow: 'auto' }}>
        <EscrowView type="time_lock" />
      </Box>
    );
  }

  if (mode === 'escrow-ilp') {
    return (
      <Box sx={{ display: 'flex', flex: 1, justifyContent: 'center', p: 1.5, minHeight: 0, overflow: 'auto' }}>
        <EscrowView type="ilp" />
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
