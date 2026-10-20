exports.handler = async (event) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  if (typeof event?.text !== 'string' || !event.text.trim()) {
    throw new Error('Notification text is required');
  }

  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: event.text }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Throw so Lambda retries asynchronously. Never log the token-bearing URL.
    throw new Error('Telegram request failed or timed out');
  }
  if (!response.ok) {
    throw new Error(`Telegram returned HTTP ${response.status}`);
  }
  const result = await response.json();
  if (!result.ok) {
    throw new Error('Telegram rejected the notification');
  }
};
