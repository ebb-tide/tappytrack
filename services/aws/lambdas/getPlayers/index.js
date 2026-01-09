const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const fetch = require("node-fetch");

const USERS_TABLE = process.env.USERS_TABLE;

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
//   const secret = event.headers && event.headers["x-internal"];
//   if (secret !== process.env.INTERNAL_SECRET) {
//     return { statusCode: 403, body: "Forbidden" };
//   }

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
  let expiresAt = user.expiresAt;
  const now = Math.floor(Date.now() / 1000);

  // If token expired, refresh
  if (expiresAt && now >= expiresAt && refreshToken) {
    try {
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
      accessToken = tokenData.access_token;
      expiresAt = now + tokenData.expires_in;
      // Optionally update user record with new token
      await ddbDocClient.send(new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { userid },
        UpdateExpression: 'SET accessToken = :at, expiresAt = :ea',
        ExpressionAttributeValues: {
          ':at': accessToken,
          ':ea': expiresAt
        }
      }));
    } catch (err) {
      const message = 'Spotify token refresh failed: ' + err.message;
      await recordUserError(ddbDocClient, userid, message);
      return { statusCode: 500, body: JSON.stringify({ error: message }) };
    }
  }

  // Fetch available players from Spotify
  let players = [];
  if (accessToken) {
    try {
      const resp = await fetch('https://api.spotify.com/v1/me/player/devices', {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      if (!resp.ok) throw new Error('Spotify players fetch failed');
      const data = await resp.json();
      players = data.devices || [];
    } catch (err) {
      const message = 'Spotify players fetch failed: ' + err.message;
      await recordUserError(ddbDocClient, userid, message);
      return { statusCode: 500, body: JSON.stringify({ error: message }) };
    }
  }

  return { statusCode: 200, body: JSON.stringify({ message: "players for user", players }) };
};
