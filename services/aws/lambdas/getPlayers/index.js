const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const USERS_TABLE = process.env.USERS_TABLE;

/**
 * Refresh the Spotify access token and persist it. Spotify occasionally
 * rotates the refresh token in the response; store the new one or the
 * account eventually becomes unrecoverable.
 */
async function refreshSpotifyToken(ddbDocClient, userid, refreshToken) {
  const params = new URLSearchParams();
  params.append('grant_type', 'refresh_token');
  params.append('refresh_token', refreshToken);
  params.append('client_id', process.env.SPOTIFY_CLIENT_ID);
  params.append('client_secret', process.env.SPOTIFY_CLIENT_SECRET);
  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });
  if (!resp.ok) throw new Error('Failed to refresh Spotify token');
  const tokenData = await resp.json();
  const accessToken = tokenData.access_token;
  const expiresAt = Math.floor(Date.now() / 1000) + tokenData.expires_in;
  const newRefreshToken = tokenData.refresh_token || refreshToken;
  await ddbDocClient.send(new UpdateCommand({
    TableName: USERS_TABLE,
    Key: { userid },
    UpdateExpression: 'SET accessToken = :at, expiresAt = :ea, refreshToken = :rt',
    ExpressionAttributeValues: {
      ':at': accessToken,
      ':ea': expiresAt,
      ':rt': newRefreshToken
    }
  }));
  return { accessToken, refreshToken: newRefreshToken, expiresAt };
}

async function recordUserError(ddbDocClient, userid, message) {
  if (!userid) return;
  try {
    await ddbDocClient.send(new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { userid },
      UpdateExpression: 'SET lastErrorMessage = :msg, lastErrorAt = :ts, lastErrorSource = :src',
      ConditionExpression: 'attribute_exists(userid)',
      ExpressionAttributeValues: {
        ':msg': message,
        ':ts': Date.now(),
        ':src': 'getPlayers'
      }
    }));
  } catch (err) {
    console.error('Failed to record last error:', err);
  }
}

exports.handler = async (event) => {
  const secret = event.headers && event.headers["x-internal"];
  if (secret !== process.env.INTERNAL_SECRET) {
    return { statusCode: 403, body: "Forbidden" };
  }

  const userid = event.queryStringParameters && event.queryStringParameters.userid;
  if (!userid) {
    console.log('Missing userid parameter');
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing userid parameter' })
    };
  }

  const client = new DynamoDBClient();
  const ddbDocClient = DynamoDBDocumentClient.from(client);

  // Lookup user record and log it
  let user;
  try {
    const userRes = await ddbDocClient.send(new GetCommand({
      TableName: USERS_TABLE,
      Key: { userid }
    }));
    user = userRes.Item;
  } catch (err) {
    const message = err.message || 'Failed to load user';
    await recordUserError(ddbDocClient, userid, message);
    return { statusCode: 500, body: JSON.stringify({ error: message }) };
  }

  if (!user) {
    return { statusCode: 404, body: JSON.stringify({ error: 'User not found' }) };
  }

  // Spotify API: get accessToken, refresh if needed, fetch devices
  let accessToken = user.accessToken;
  let refreshToken = user.refreshToken;
  const expiresAt = user.expiresAt;
  const now = Math.floor(Date.now() / 1000);

  // If token expired, refresh
  if (expiresAt && now >= expiresAt && refreshToken) {
    try {
      const refreshed = await refreshSpotifyToken(ddbDocClient, userid, refreshToken);
      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken;
    } catch (err) {
      const message = 'Spotify token refresh failed: ' + err.message;
      await recordUserError(ddbDocClient, userid, message);
      return { statusCode: 500, body: JSON.stringify({ error: message }) };
    }
  }

  if (!accessToken) {
    const message = 'Spotify is not connected. Reconnect Spotify to load your devices.';
    await recordUserError(ddbDocClient, userid, message);
    return { statusCode: 401, body: JSON.stringify({ error: message }) };
  }

  // Fetch available players from Spotify
  let players = [];
  if (accessToken) {
    try {
      const fetchDevices = () => fetch('https://api.spotify.com/v1/me/player/devices', {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      let resp = await fetchDevices();
      // A stale or missing expiresAt can hide an expired token. Retry only once.
      if (resp.status === 401 && refreshToken) {
        const refreshed = await refreshSpotifyToken(ddbDocClient, userid, refreshToken);
        accessToken = refreshed.accessToken;
        refreshToken = refreshed.refreshToken;
        resp = await fetchDevices();
      }
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        const detail = typeof data.error?.message === 'string' ? data.error.message : '';
        let message = `Could not load Spotify devices (Spotify ${resp.status}).`;
        if (/permissions? missing|insufficient.*scope/i.test(detail)) {
          message = 'Spotify permissions are missing. Reconnect Spotify and allow access to your devices and playback.';
        } else if (resp.status === 401) {
          message = 'Your Spotify connection has expired. Reconnect Spotify to load your devices.';
        } else if (resp.status === 403) {
          message = 'Spotify denied access to your devices. Reconnect Spotify; if this continues, check the Spotify app access settings.';
        } else if (resp.status === 429) {
          message = 'Spotify is receiving too many requests. Wait a little, then refresh devices.';
        }
        const error = new Error(message);
        error.status = resp.status;
        throw error;
      }
      const data = await resp.json();
      players = data.devices || [];
    } catch (err) {
      const message = err.status ? err.message : 'Could not load Spotify devices. Please try again.';
      await recordUserError(ddbDocClient, userid, message);
      return { statusCode: err.status || 502, body: JSON.stringify({ error: message }) };
    }
  }

  return { statusCode: 200, body: JSON.stringify({ message: "players for user", players }) };
};
