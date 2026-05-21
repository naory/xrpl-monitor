# Network Switcher — Design Spec

## Goal

Hot-switch the XRPL connection between Mainnet, Testnet, and Devnet from the UI without restarting the server. Clear live store state on switch. Default to Mainnet on restart (no persistence).

---

## Networks

| Name | WebSocket URL |
|------|--------------|
| `mainnet` | `wss://s1.ripple.com/` |
| `testnet` | `wss://s.altnet.rippletest.net:51233` |
| `devnet` | `wss://s.devnet.rippletest.net:51233` |

---

## Architecture

### Switch Sequence

```
UI clicks "TESTNET"
  → POST /network/switch { network: 'testnet' }
  → server disconnects XRPL client (~200ms)
  → server reconnects to testnet URL (~500ms)
  → server publishes network_change to Redis
  → WS broadcasts { type: 'network_change', network: 'testnet' }
  → store.setNetwork('testnet') — clears live arrays
  → UI label confirms "TESTNET"
```

### State

`currentNetwork` lives in-memory on the server (`let currentNetwork = 'mainnet'`). No persistence — defaults to `'mainnet'` on restart.

---

## Server

### Modified Files

| File | Change |
|------|--------|
| `server/src/ingest/xrplClient.js` | Export `switchNetwork(name)` and `getCurrentNetwork()`; add in-flight lock |
| `server/src/redis/publisher.js` | Add `CHANNELS.NETWORK = 'xrpl:network'`; `publishNetworkChange(redis, network)` |
| `server/src/api/app.js` | Mount `createNetworkRouter` at `/network`; add `network` field to `GET /health` |
| `server/src/api/ws.js` | Add `CHANNELS.NETWORK` to `SUBSCRIBED_CHANNELS` |

### New Files

| File | Responsibility |
|------|----------------|
| `server/src/api/network.js` | `GET /network` → `{ network }`; `POST /network/switch` → validates, calls `switchNetwork`, returns `{ network }` |

### `switchNetwork(name)` in xrplClient.js

```js
const NETWORK_URLS = {
  mainnet: 'wss://s1.ripple.com/',
  testnet: 'wss://s.altnet.rippletest.net:51233',
  devnet:  'wss://s.devnet.rippletest.net:51233',
};

let currentNetwork = 'mainnet';
let switching = false;

async function switchNetwork(name) {
  if (!NETWORK_URLS[name]) throw Object.assign(new Error('Unknown network'), { status: 400 });
  if (switching) throw Object.assign(new Error('Switch in progress'), { status: 409 });
  switching = true;
  try {
    await client.disconnect();
    // xrpl.js v4: recreate client with new URL
    client = new xrpl.Client(NETWORK_URLS[name]);
    await client.connect();
    currentNetwork = name;
  } finally {
    switching = false;
  }
}

function getCurrentNetwork() { return currentNetwork; }
```

If xrpl.js v4 does not support URL reassignment cleanly, destroy the old client and construct a new one. The existing reconnection/backoff logic re-attaches on the new client instance.

### REST Endpoints

**`GET /network`**
```json
{ "network": "mainnet" }
```

**`POST /network/switch`**
- Body: `{ "network": "testnet" }`
- Success 200: `{ "network": "testnet" }`
- Unknown network → 400
- Switch in progress → 409

### WebSocket Event (published after successful reconnect)

```json
{ "type": "network_change", "network": "testnet" }
```

### Health Endpoint

`GET /health` gains a `network` field:
```json
{ "status": "ok", "xrplConnected": true, "network": "mainnet" }
```

---

## Client

### Modified Files

| File | Change |
|------|--------|
| `client/src/api/http.js` | Add `fetchCurrentNetwork()` → `GET /network`; `switchNetwork(network)` → `POST /network/switch` |
| `client/src/store/useWsStore.js` | Add `currentNetwork: 'mainnet'`; `setNetwork(network)` — updates field and clears `escrowEvents: []` (and any other live arrays) atomically |
| `client/src/api/socket.js` | Route `msg.type === 'network_change'` → `store.setNetwork(msg.network)` |
| `client/src/App.jsx` | On mount, call `fetchCurrentNetwork()` → `store.setNetwork(network)`; render network selector in header |
| `client/vite.config.js` | Add `/network` proxy entry → `http://127.0.0.1:3001` |

### Network Selector UI

Compact segmented button group (or `<select>`) in the top-right of the app header showing `MAINNET / TESTNET / DEVNET`. Active network highlighted.

On change:
1. Optimistically update displayed label
2. Call `POST /network/switch`
3. If POST fails or no `network_change` WS message arrives within 5s → revert label + show error toast
4. On `network_change` WS message → label confirmed, store cleared

### `setNetwork` in useWsStore.js

```js
setNetwork: (network) => set(() => ({
  currentNetwork: network,
  escrowEvents: [],
  // extend here as more live arrays are added
})),
```

### On App Load

```js
useEffect(() => {
  fetchCurrentNetwork().then(({ network }) => store.setNetwork(network));
}, []);
```

Historical data (DB-backed charts) is NOT cleared on switch — time-bounded queries remain valid for the old network's historical data. Only live store arrays clear.

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Unknown network name in POST | 400, client reverts optimistic label |
| Switch already in progress | 409, client reverts optimistic label |
| XRPL reconnect fails | Existing backoff retries; `network_change` not published; client times out after 5s and reverts |
| POST times out | Client reverts after 5s |
| `GET /network` fails on load | Store keeps default `'mainnet'`; badge shows `MAINNET` |

---

## Testing

- **Unit:** `switchNetwork` — mock `client.disconnect/connect`; verify URL changes; verify `getCurrentNetwork()` updates; verify 400 on unknown network; verify 409 on concurrent switch
- **Unit:** `store.setNetwork` — verify `currentNetwork` updates and `escrowEvents` clears atomically
- **Manual:** switch to Testnet in UI → badge updates → live feed clears → new escrow events arrive tagged to Testnet

---

## Non-Goals

- Persisting network selection across server restarts
- Per-tab network selection (all tabs share one server connection)
- Historical data separation by network (data mixes if you switch mid-window)
