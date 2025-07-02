const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");
const fetch = require("node-fetch");

const CARDS_TABLE = process.env.CARDS_TABLE;
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

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

  const { userid, cardID, spotifyURL } = data;
  if (!userid || !cardID || !spotifyURL) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing fields" }) };
  }

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
    return { statusCode: 201, body: JSON.stringify({ message: "Card added", trackName, artistName }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};