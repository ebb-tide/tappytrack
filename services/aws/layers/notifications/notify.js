const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

const client = new LambdaClient({ maxAttempts: 1 });

// Wait only for AWS to accept the event, never for Telegram delivery. Dropping
// this promise would let Lambda freeze the process before the handoff finishes.
async function notify(text) {
  const functionName = process.env.NOTIFICATION_FUNCTION;
  if (!functionName) return;

  try {
    const result = await client.send(new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ text })),
    }), { abortSignal: AbortSignal.timeout(500) });
    if (result.StatusCode !== 202) {
      throw new Error('Notification was not accepted');
    }
  } catch (err) {
    // Notification submission must not turn a successful user action into an
    // error. Avoid logging the SDK error object, which can contain the payload.
    console.error('Notification enqueue failed:', err.name || 'Error');
  }
}

module.exports = { notify };
