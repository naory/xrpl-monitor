import { Box, Paper, Typography, Chip } from '@mui/material';
import { AnimatePresence, motion } from 'framer-motion';
import { useWsStore } from '../store/useWsStore';

function timeAgo(isoStr) {
  const delta = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (delta < 60)   return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  return `${Math.floor(delta / 3600)}h ago`;
}

function FillCard({ fill }) {
  const price = fill.getsValue && fill.paysValue
    ? (parseFloat(fill.paysValue) / parseFloat(fill.getsValue)).toPrecision(6)
    : '—';

  const label = `${fill.getsCurrency} → ${fill.paysCurrency}`;

  return (
    <Paper
      sx={{
        px: 1.5, py: 1, mb: 0.5,
        borderLeft: `3px solid`,
        borderColor: fill.fillType === 'full' ? 'success.main' : 'warning.main',
        bgcolor: 'background.paper',
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="body2" sx={{ color: 'text.primary', fontWeight: 600 }}>
          {label}
        </Typography>
        <Chip
          label={fill.fillType}
          size="small"
          color={fill.fillType === 'full' ? 'success' : 'warning'}
          variant="outlined"
          sx={{ height: 16, fontSize: '0.6rem' }}
        />
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {parseFloat(fill.getsValue).toFixed(4)} {fill.getsCurrency}
        </Typography>
        <Typography variant="caption" color="primary.main">
          @ {price}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {fill.ledgerTime ? timeAgo(fill.ledgerTime) : ''}
        </Typography>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ opacity: 0.5 }}>
        {fill.account?.slice(0, 16)}…
      </Typography>
    </Paper>
  );
}

export function FillStream() {
  const fills = useWsStore((s) => s.fills);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="h6" sx={{ fontSize: '0.85rem', color: 'primary.main', textTransform: 'uppercase', letterSpacing: 2 }}>
          Live Fills
        </Typography>
        <Chip label={fills.length} size="small" variant="outlined" color="primary" sx={{ height: 18, fontSize: '0.65rem' }} />
      </Box>

      {fills.length === 0 && (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography variant="caption" color="text.secondary">
            Waiting for fills…
          </Typography>
        </Box>
      )}

      <Box sx={{ flex: 1, overflowY: 'auto', '&::-webkit-scrollbar': { width: 4 }, '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(255,255,255,0.1)', borderRadius: 2 } }}>
        <AnimatePresence initial={false}>
          {fills.map((fill) => (
            <motion.div
              key={fill.txHash + fill.account}
              initial={{ opacity: 0, y: -16, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
            >
              <FillCard fill={fill} />
            </motion.div>
          ))}
        </AnimatePresence>
      </Box>
    </Box>
  );
}
