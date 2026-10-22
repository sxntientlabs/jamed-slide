function requestAbortedError(signal) {
  if (signal?.reason instanceof Error && signal.reason.name !== "AbortError") return signal.reason;
  return Object.assign(new Error("Koneksi Agentic terputus."), { code: "request_aborted" });
}

function waitForTurn(turn, signal) {
  if (!signal) return turn;
  if (signal.aborted) return Promise.reject(requestAbortedError(signal));

  return new Promise((resolve, reject) => {
    const abort = () => reject(requestAbortedError(signal));
    signal.addEventListener("abort", abort, { once: true });
    turn.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/**
 * Serializes work that targets one shared Rakazo bot/computer.
 *
 * Rakazo currently exposes one native thread for the bridged bot. Without a
 * queue, two HTTP requests can subscribe to the same event stream and each
 * consume the other request's reply. The queue keeps the bridge lightweight
 * while making that shared resource deterministic.
 */
export function createExclusiveQueue() {
  let tail = Promise.resolve();
  let pending = 0;

  return {
    get pending() {
      return pending;
    },

    run(task, { signal, onQueued } = {}) {
      const previous = tail;
      const queuedBefore = pending;
      let release;
      const turn = new Promise((resolve) => {
        release = resolve;
      });
      tail = previous.then(() => turn);
      pending += 1;
      if (queuedBefore > 0) onQueued?.(queuedBefore);

      return (async () => {
        try {
          await waitForTurn(previous, signal);
          if (signal?.aborted) throw requestAbortedError(signal);
          return await task();
        } finally {
          pending -= 1;
          release();
        }
      })();
    },
  };
}
