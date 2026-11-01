const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const CARDS_TABLE = process.env.CARDS_TABLE;
const USERS_TABLE = process.env.USERS_TABLE;
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const { notify } = require('/opt/notify');

function extractSpotifyTrackId(url) {
  const match = url.match(/spotify\.com\/track\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

async function getSpotifyAppToken(signal) {
  const creds = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    signal,
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

const client = new DynamoDBClient({ maxAttempts: 1 });
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
    }), { abortSignal: AbortSignal.timeout(300) });
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

  // Search selections already have metadata. Pasted URLs still use the bounded lookup.
  const label = value => typeof value === 'string' && value.trim().length <= 512 ? value.trim() : '';
  let trackName = label(data.trackName) || null;
  let artistName = label(data.artistName) || null;
  try {
    const trackId = extractSpotifyTrackId(spotifyURL);
    if (trackId && !(trackName && artistName)) {
      // Song details are optional. Share one budget across both requests and
      // their response bodies so slow Spotify calls cannot prevent saving.
      const signal = AbortSignal.timeout(1500);
      const token = await getSpotifyAppToken(signal);
      const resp = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
        signal,
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (resp.ok) {
        const track = await resp.json();
        trackName = track.name;
        artistName = track.artists && track.artists.length > 0 ? track.artists[0].name : null;
      }
    }
  } catch (err) {
    console.warn('Optional Spotify track lookup failed:', err.name || 'Error');
  }

  try {
    await ddbDocClient.send(new PutCommand({
      TableName: CARDS_TABLE,
      Item: { userid, cardID, spotifyURL, trackName, artistName }
    }), { abortSignal: AbortSignal.timeout(1000) });
    const trackLabel = trackName ? `${trackName}${artistName ? ' — ' + artistName : ''}` : spotifyURL;
    await notify(`🎵 ${userid} added a card: ${trackLabel}`);
    return { statusCode: 201, body: JSON.stringify({ message: "Card added", trackName, artistName }) };
  } catch (err) {
    const message = err.message || 'Failed to add card';
    await recordUserError(userid, message);
    return { statusCode: 500, body: JSON.stringify({ error: message }) };
  }
};
