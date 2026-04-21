export function parseWsMessage(raw) {
  try {
    const envelope = JSON.parse(raw);
    if (!envelope.raw) return null;
    return JSON.parse(envelope.raw);
  } catch {
    return null;
  }
}

export function createSocketConnection(url, store) {
  let ws = null;
  let reconnectTimer = null;
  let stopped = false;

  function connect() {
    if (stopped) return;
    ws = new WebSocket(url);

    ws.onopen = () => store.setConnected(true);

    ws.onclose = () => {
      store.setConnected(false);
      if (!stopped) reconnectTimer = setTimeout(connect, 3000);
    };

    ws.onerror = () => {};

    ws.onmessage = ({ data }) => {
      const msg = parseWsMessage(data);
      if (!msg) return;
      if (msg.type === 'fill')          store.addFill(msg.data);
      if (msg.type === 'topk:changed')  store.setTopK(msg.data.pairs ?? []);
    };
  }

  connect();

  return function disconnect() {
    stopped = true;
    clearTimeout(reconnectTimer);
    ws?.close();
  };
}
