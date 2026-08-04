import { useState, useCallback } from 'react';
import { Box, Typography, TextField, InputAdornment, Chip, CircularProgress, ToggleButtonGroup, ToggleButton, IconButton, Tooltip } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useDomains, useDexOffers } from '../hooks/useDomains';
import { triggerDomainCrawl } from '../api/http';
import { useWsStore } from '../store/useWsStore';

const xrpScan = {
  account: (addr, net) => net === 'mainnet'
    ? `https://xrpscan.com/account/${addr}`
    : `https://testnet.xrpscan.com/account/${addr}`,
};

function fmtAddr(addr) {
  if (!addr) return '—';
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function fmtAmount(amount) {
  if (!amount) return '—';
  if (typeof amount === 'string') {
    const xrp = parseInt(amount, 10) / 1e6;
    return `${xrp.toLocaleString(undefined, { maximumFractionDigits: 6 })} XRP`;
  }
  return `${parseFloat(amount.value).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${amount.currency}`;
}

function AddrLink({ addr, network }) {
  if (!addr) return <span>—</span>;
  return (
    <a href={xrpScan.account(addr, network)} target="_blank" rel="noopener noreferrer"
      style={{ color: 'inherit', textDecoration: 'none', fontFamily: 'JetBrains Mono' }}
      title={addr}>
      {fmtAddr(addr)}
    </a>
  );
}

function CredentialBadge({ cred }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, p: 0.75,
      border: '1px solid rgba(255,255,255,0.08)', borderRadius: 1, bgcolor: 'background.default' }}>
      <Typography sx={{ fontSize: '0.65rem', color: '#58a6ff', fontFamily: 'JetBrains Mono', fontWeight: 600 }}>
        {cred.typeDecoded}
      </Typography>
      <Typography sx={{ fontSize: '0.6rem', color: 'text.secondary', fontFamily: 'JetBrains Mono' }}
        title={cred.issuer}>
        issuer: {fmtAddr(cred.issuer)}
      </Typography>
    </Box>
  );
}

function DomainRow({ domain, network, expanded, onToggle }) {
  const creds = domain.credentials ?? [];
  return (
    <Box>
      <Box
        onClick={onToggle}
        sx={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 90px 70px 70px',
          alignItems: 'center', px: 2, py: 1,
          borderBottom: '1px solid', borderColor: 'divider',
          cursor: 'pointer',
          '&:hover': { bgcolor: 'action.hover' },
          bgcolor: expanded ? 'action.selected' : 'transparent',
        }}
      >
        <Typography sx={{ fontSize: '0.7rem', fontFamily: 'JetBrains Mono', color: 'text.primary' }}>
          <AddrLink addr={domain.owner} network={network} />
        </Typography>
        <Typography sx={{ fontSize: '0.65rem', color: 'text.secondary', fontFamily: 'JetBrains Mono' }}
          title={domain.index}>
          {domain.index.slice(0, 16)}…
        </Typography>
        <Typography sx={{ fontSize: '0.7rem', color: 'text.primary', textAlign: 'center' }}>
          {creds.length}
        </Typography>
        <Typography sx={{ fontSize: '0.7rem', color: domain.offer_count > 0 ? '#3fb950' : 'text.secondary', textAlign: 'center' }}>
          {domain.offer_count}
        </Typography>
        <Typography sx={{ fontSize: '0.65rem', color: expanded ? '#58a6ff' : 'text.disabled', textAlign: 'right' }}>
          {expanded ? '▲' : '▼'}
        </Typography>
      </Box>

      {expanded && (
        <Box sx={{ px: 2, py: 1.5, bgcolor: 'background.default', borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', letterSpacing: 1, textTransform: 'uppercase', mb: 1 }}>
            Accepted Credentials
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {creds.length === 0
              ? <Typography sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>No credentials</Typography>
              : creds.map((c, i) => <CredentialBadge key={i} cred={c} />)
            }
          </Box>
          <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled', mt: 1.5, fontFamily: 'JetBrains Mono' }}>
            domain ID: {domain.index}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

function DomainsTab({ network }) {
  const [search, setSearch] = useState('');
  const [query,  setQuery]  = useState('');
  const [expanded, setExpanded] = useState(null);

  const { data, isLoading } = useDomains({ search: query });

  const handleSearch = useCallback((e) => {
    if (e.key === 'Enter') setQuery(search.trim());
  }, [search]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ p: 1.5, display: 'flex', gap: 1.5, alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider' }}>
        <TextField
          size="small" placeholder="Search owner, credential type, or issuer…"
          value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={handleSearch}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 16, color: 'text.disabled' }} /></InputAdornment> }}
          sx={{ flex: 1, '& .MuiInputBase-input': { fontSize: '0.75rem' } }}
        />
        <Chip label={`${data?.total ?? '…'} domains`} size="small" variant="outlined" sx={{ fontSize: '0.65rem' }} />
        {isLoading && <CircularProgress size={16} />}
      </Box>

      {/* Table header */}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 90px 70px 70px',
        px: 2, py: 0.75, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
        {['Owner', 'Domain ID', 'Credentials', 'DEX Offers', ''].map((h) => (
          <Typography key={h} sx={{ fontSize: '0.6rem', color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.8 }}>
            {h}
          </Typography>
        ))}
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {!isLoading && data?.domains?.length === 0 && (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>
              No permissioned domains found on {network}.
              {network === 'mainnet' && ' Try switching to testnet.'}
            </Typography>
          </Box>
        )}
        {data?.domains?.map((d) => (
          <DomainRow
            key={d.index}
            domain={d}
            network={network}
            expanded={expanded === d.index}
            onToggle={() => setExpanded(expanded === d.index ? null : d.index)}
          />
        ))}
      </Box>
    </Box>
  );
}

function DexTab({ network }) {
  const [search, setSearch] = useState('');
  const [query,  setQuery]  = useState('');

  const { data, isLoading } = useDexOffers({ search: query });

  const handleSearch = useCallback((e) => {
    if (e.key === 'Enter') setQuery(search.trim());
  }, [search]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ p: 1.5, display: 'flex', gap: 1.5, alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider' }}>
        <TextField
          size="small" placeholder="Search account or domain ID…"
          value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={handleSearch}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 16, color: 'text.disabled' }} /></InputAdornment> }}
          sx={{ flex: 1, '& .MuiInputBase-input': { fontSize: '0.75rem' } }}
        />
        <Chip label={`${data?.total ?? '…'} offers`} size="small" variant="outlined" sx={{ fontSize: '0.65rem' }} />
        {isLoading && <CircularProgress size={16} />}
      </Box>

      {/* Table header */}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr',
        px: 2, py: 0.75, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
        {['Account', 'Domain ID', 'Taker Gets', 'Taker Pays'].map((h) => (
          <Typography key={h} sx={{ fontSize: '0.6rem', color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.8 }}>
            {h}
          </Typography>
        ))}
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {!isLoading && data?.offers?.length === 0 && (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>
              No permissioned DEX offers indexed yet on {network}.
              {network === 'mainnet' && ' Try switching to testnet.'}
              {' '}Scanning is in progress and runs every 15 minutes.
            </Typography>
          </Box>
        )}
        {data?.offers?.map((o) => (
          <Box key={o.index} sx={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr',
            alignItems: 'center', px: 2, py: 0.9,
            borderBottom: '1px solid', borderColor: 'divider',
            '&:hover': { bgcolor: 'action.hover' },
          }}>
            <Typography sx={{ fontSize: '0.7rem', fontFamily: 'JetBrains Mono' }}>
              <AddrLink addr={o.account} network={network} />
            </Typography>
            <Typography sx={{ fontSize: '0.65rem', color: 'text.secondary', fontFamily: 'JetBrains Mono' }}
              title={o.domain_id}>
              {o.domain_id.slice(0, 12)}…
            </Typography>
            <Typography sx={{ fontSize: '0.7rem', color: 'text.primary' }}>
              {fmtAmount(o.taker_gets)}
            </Typography>
            <Typography sx={{ fontSize: '0.7rem', color: 'text.primary' }}>
              {fmtAmount(o.taker_pays)}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export function DomainsView() {
  const [tab, setTab] = useState('domains');
  const [refreshing, setRefreshing] = useState(false);
  const currentNetwork = useWsStore((s) => s.currentNetwork);
  const network = currentNetwork ?? 'mainnet';

  async function handleRefresh() {
    setRefreshing(true);
    try { await triggerDomainCrawl(); } catch {}
    setTimeout(() => setRefreshing(false), 2000);
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1,
        borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
        <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled', letterSpacing: 1.5, textTransform: 'uppercase' }}>
          Permissioned
        </Typography>

        <ToggleButtonGroup value={tab} exclusive size="small"
          onChange={(_, v) => v && setTab(v)} sx={{ height: 24 }}>
          <ToggleButton value="domains" sx={{ fontSize: '0.6rem', px: 1.2, py: 0 }}>Domains</ToggleButton>
          <ToggleButton value="dex"     sx={{ fontSize: '0.6rem', px: 1.2, py: 0 }}>DEX Offers</ToggleButton>
        </ToggleButtonGroup>

        <Chip
          label={network.toUpperCase()} size="small" variant="outlined"
          sx={{ fontSize: '0.6rem', height: 20,
            color:        network === 'mainnet' ? 'success.main' : network === 'testnet' ? 'warning.main' : 'info.main',
            borderColor:  network === 'mainnet' ? 'success.main' : network === 'testnet' ? 'warning.main' : 'info.main',
          }}
        />

        <Box sx={{ flex: 1 }} />

        <Tooltip title="Trigger crawl now">
          <span>
            <IconButton size="small" onClick={handleRefresh} disabled={refreshing}>
              <RefreshIcon sx={{ fontSize: 16, ...(refreshing ? { animation: 'spin 1s linear infinite', '@keyframes spin': { '100%': { transform: 'rotate(360deg)' } } } : {}) }} />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        {tab === 'domains' && <DomainsTab network={network} />}
        {tab === 'dex'     && <DexTab     network={network} />}
      </Box>
    </Box>
  );
}
