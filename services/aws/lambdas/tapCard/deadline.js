const WORK_BUDGET_MS = 4300;
const RESPONSE_RESERVE_MS = 700;

function isTimeout(error) {
  return error.status === 504 || error.name === 'AbortError' || error.name === 'TimeoutError';
}

function timeoutError(operation) {
  const error = new Error(`${operation} timed out; tap processing stopped`);
  error.status = 504;
  return error;
}

function createDeadline(context, { now = Date.now, signalFor = ms => AbortSignal.timeout(ms) } = {}) {
  const available = context?.getRemainingTimeInMillis?.() ?? 5000;
  const end = now() + Math.max(0, Math.min(WORK_BUDGET_MS, available - RESPONSE_RESERVE_MS));

  async function run(operation, cap, action, reserveMs = 0) {
    const remaining = end - now() - reserveMs;
    if (remaining <= 0) throw timeoutError(operation);
    const signal = signalFor(Math.max(1, Math.floor(Math.min(cap, remaining))));
    try {
      return await action(signal);
    } catch (error) {
      if (signal.aborted || isTimeout(error)) throw timeoutError(operation);
      throw error;
    }
  }

  return {
    fetch: (url, options, operation = 'Spotify request', reserveMs = 0) => run(operation, 2000,
      signal => fetch(url, { ...options, signal }), reserveMs),
    send: (client, command) => run('Database request', 1000,
      signal => client.send(command, { abortSignal: signal })),
  };
}

module.exports = { createDeadline, isTimeout };
