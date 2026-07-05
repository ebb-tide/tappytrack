const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const CARDS_TABLE = process.env.CARDS_TABLE;
const USERS_TABLE = process.env.USERS_TABLE;
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Best-effort Telegram ping; must never fail the main flow.
async function notify(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
      signal: AbortSignal.timeout(3000)
    });
  } catch (err) {
    console.error('Telegram notify failed:', err);
  }
}

function extractSpotifyTrackId(url) {
  const match = url.match(/spotify\.com\/track\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

async function getSpotifyAppToken() {
  const creds = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' })
  });
  if (!res.ok) throw new Error('Failed to get Spotify app token');
  const data = await res.json();
  return data.access_token;
}

const client = new DynamoDBClient();
const ddbDocClient = DynamoDBDocumentClient.from(client);

async function recordUserError(userid, message) {
  if (!USERS_TABLE || !userid) return;
  try {
    await ddbDocClient.send(new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { userid },
      UpdateExpression: 'SET lastErrorMessage = :msg, lastErrorAt = :ts, lastErrorSource = :src',
      ConditionExpression: 'attribute_exists(userid)',
      ExpressionAttributeValues: {
        ':msg': message,
        ':ts': Date.now(),
        ':src': 'addCard'
      }
    }));
  } catch (err) {
    console.error('Failed to record last error:', err);
  }
}

exports.handler = async (event) => {
  const secret = event.headers["x-internal"];
  if (secret !== process.env.INTERNAL_SECRET) {
    return { statusCode: 403, body: "Forbidden" };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  let { userid, cardID, spotifyURL } = data;
  if (!userid || !cardID || !spotifyURL) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing fields" }) };
  }

  cardID = cardID.toUpperCase();

  // Lookup track info from Spotify
  let trackName = null;
  let artistName = null;
  try {
    const trackId = extractSpotifyTrackId(spotifyURL);
    if (trackId) {
      const token = await getSpotifyAppToken();
      const resp = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (resp.ok) {
        const track = await resp.json();
        trackName = track.name;
        artistName = track.artists && track.artists.length > 0 ? track.artists[0].name : null;
      }
    }
  } catch (err) {
    // If lookup fails, just continue without track info
  }

  try {
    await ddbDocClient.send(new PutCommand({
      TableName: CARDS_TABLE,
      Item: { userid, cardID, spotifyURL, trackName, artistName }
    }));
    const trackLabel = trackName ? `${trackName}${artistName ? ' — ' + artistName : ''}` : spotifyURL;
    await notify(`🎵 ${userid} added a card: ${trackLabel}`);
    return { statusCode: 201, body: JSON.stringify({ message: "Card added", trackName, artistName }) };
  } catch (err) {
    const message = err.message || 'Failed to add card';
    await recordUserError(userid, message);
    return { statusCode: 500, body: JSON.stringify({ error: message }) };
  }
};
