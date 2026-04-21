import { Box, Typography, CircularProgress, Divider } from '@mui/material';
import { useSpring, animated } from '@react-spring/web';
import { useOrderBook } from '../hooks/useOrderBook';
import { useWsStore } from '../store/useWsStore';

function parseOfferAmount(raw) {
  if (!raw) return 0;
  if (typeof raw === 'string') return parseFloat(raw) / 1_000_000;
  return parseFloat(raw.value ?? 0);
}

function processOffers(offers = []) {
  return offers.slice(0, 12).map((o) => ({
    price: parseOfferAmount(o.TakerPays) / (parseOfferAmount(o.TakerGets) || 1),
    size:  parseOfferAmount(o.TakerGets),
  }));
}

function DepthBar({ value, max, color, label, price }) {
  const style = useSpring({
    width: `${max > 0 ? (value / max) * 100 : 0}%`,
    config: { tension: 180, friction: 24 },
  });

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.4, position: 'relative' }}>
      <Box sx={{ flex: 1, height: 18, position: 'relative', bgcolor: 'rgba(255,255,255,0.04)', borderRadius: 0.5, overflow: 'hidden' }}>
        <animated.div
          style={{
            ...style,
            height: '100%',
            background: color,
            opacity: 0.25,
            position: 'absolute',
            left: 0,
            top: 0,
          }}
        />
      </Box>
      <Typography variant="caption" sx={{ width: 68, textAlign: 'right', color: 'text.secondary' }}>
        {value.toFixed(4)}
      </Typography>
      <Typography variant="caption" sx={{ width: 72, textAlign: 'right', color }}>
        {price.toPrecision(5)}
      </Typography>
    </Box>
  );
}

export function OrderBook() {
  const selectedPair = useWsStore((s) => s.selectedPair);
  const { data, isLoading } = useOrderBook(selectedPair);

  const bids = processOffers(data?.bids);
  const asks = processOffers(data?.asks);
  const maxBid = Math.max(...bids.map((b) => b.size), 0);
  const maxAsk = Math.max(...asks.map((a) => a.size), 0);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Typography variant="h6" sx={{ fontSize: '0.85rem', color: 'primary.main', textTransform: 'uppercase', letterSpacing: 2, mb: 1 }}>
        Order Book
      </Typography>

      {!selectedPair && (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography variant="caption" color="text.secondary">Select a pair from the leaderboard</Typography>
        </Box>
      )}

      {selectedPair && isLoading && (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CircularProgress size={20} />
        </Box>
      )}

      {selectedPair && !isLoading && (
        <>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ width: 68, textAlign: 'right' }}>Size</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ width: 72, textAlign: 'right' }}>Price</Typography>
          </Box>

          <Box sx={{ mb: 1 }}>
            {asks.slice().reverse().map((ask, i) => (
              <DepthBar key={i} value={ask.size} max={maxAsk} color="#ff1744" price={ask.price} />
            ))}
          </Box>

          <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', my: 0.5 }} />

          <Box sx={{ mt: 1 }}>
            {bids.map((bid, i) => (
              <DepthBar key={i} value={bid.size} max={maxBid} color="#00e676" price={bid.price} />
            ))}
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 'auto', pt: 1 }}>
            <Typography variant="caption" color="success.main">{bids.length} bids</Typography>
            <Typography variant="caption" color="error.main">{asks.length} asks</Typography>
          </Box>
        </>
      )}
    </Box>
  );
}
