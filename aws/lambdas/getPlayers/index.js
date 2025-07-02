const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const fetch = require("node-fetch");

const USERS_TABLE = process.env.USERS_TABLE;

exports.handler = async (event) => {
//   const secret = event.headers && event.headers["x-internal"];
//   if (secret !== process.env.INTERNAL_SECRET) {
//     return { statusCode: 403, body: "Forbidden" };
//   }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }
  const { userid } = data;
  if (!userid) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing userid" }) };
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
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
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
      return { statusCode: 500, body: JSON.stringify({ error: 'Spotify token refresh failed: ' + err.message }) };
    }
  }

  // Fetch available devices from Spotify
  let devices = [];
  if (accessToken) {
    try {
      const resp = await fetch('https://api.spotify.com/v1/me/player/devices', {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      if (!resp.ok) throw new Error('Spotify devices fetch failed');
      const data = await resp.json();
      devices = data.devices || [];
    } catch (err) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Spotify devices fetch failed: ' + err.message }) };
    }
  }

  return { statusCode: 200, body: JSON.stringify({ message: "players for user", devices }) };
};
