import { Box, Paper } from '@mui/material';
import { Leaderboard }   from './Leaderboard';
import { PairGrid }      from './PairGrid';
import { AmmGrid }       from './AmmGrid';
import { LedgerStats }   from './LedgerStats';
import { BridgeView }    from './BridgeView';
import { XrpDemandView } from './XrpDemandView';
import { EscrowView }    from './EscrowView';
import { DomainsView }   from './DomainsView';
import { OrderBook }     from './OrderBook';
import { PriceChart }    from './PriceChart';

const panel = {
  p: 2,
  height: '100%',
  boxSizing: 'border-box',
  bgcolor: 'background.paper',
};

export function Dashboard({ mode, window }) {
  // REST-only components don't have a "live" mode; use 10m as the shortest window.
  const restWindow = window === 'live' ? '10m' : window;

  if (mode === 'ledger') {
    return (
      <Box sx={{ flex: 1, p: 1.5, minHeight: 0, overflow: 'hidden' }}>
        <LedgerStats window={restWindow} />
      </Box>
    );
  }

  if (mode === 'xrp-flow') {
    return (
      <Box sx={{ display: 'flex', flex: 1, gap: 1.5, p: 1.5, minHeight: 0, overflow: 'hidden' }}>
        <Box sx={{ flex: 1, minWidth: 0, overflow: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper' }}>
          <BridgeView window={window} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, overflow: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper' }}>
          <XrpDemandView window={window} />
        </Box>
      </Box>
    );
  }

  if (mode === 'escrow-time') {
    return (
      <Box sx={{ display: 'flex', flex: 1, justifyContent: 'center', p: 1.5, minHeight: 0, overflow: 'auto' }}>
        <EscrowView key="time_lock" type="time_lock" window={window} />
      </Box>
    );
  }

  if (mode === 'escrow-ilp') {
    return (
      <Box sx={{ display: 'flex', flex: 1, justifyContent: 'center', p: 1.5, minHeight: 0, overflow: 'auto' }}>
        <EscrowView key="ilp" type="ilp" window={window} />
      </Box>
    );
  }

  if (mode === 'domains') {
    return (
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden', border: '1px solid', borderColor: 'divider', borderRadius: 1, m: 1.5, bgcolor: 'background.paper' }}>
        <DomainsView />
      </Box>
    );
  }

  const centrePanel = mode === 'amm'
    ? <AmmGrid window={restWindow} />
    : <PairGrid window={restWindow} mode={mode} />;

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
        <Leaderboard window={restWindow} mode={mode} />
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
