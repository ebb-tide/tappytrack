const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const DEVICES_TABLE = process.env.DEVICES_TABLE;
const CARDS_TABLE = process.env.CARDS_TABLE;
const USERS_TABLE = process.env.USERS_TABLE;

function spotifyError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Resolve the best available Spotify device for playback.
 * Strategy:
 *   1. Match by saved device name (names are stable across sessions, unlike IDs)
 *   2. Match by saved device ID (in case it's still valid)
 *   3. Fall back to whichever device is currently active
 *   4. Fall back to the first available device
 *   5. Fall back to the saved device ID even if unlisted (it may be asleep)
 * Returns { deviceId, deviceName, source } or null if there is nothing to try.
 */
async function resolveDevice(accessToken, user) {
  let devices = [];
  try {
    const resp = await fetch('https://api.spotify.com/v1/me/player/devices', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (resp.status === 401) {
      throw spotifyError('Spotify auth failed while listing devices', 401);
    }
    if (resp.ok) {
      const data = await resp.json();
      devices = data.devices || [];
    }
  } catch (err) {
    if (err.status === 401) throw err;
    // If device fetch fails otherwise, fall through to the saved fallback
  }

  if (devices.length > 0) {
    // 1. Match by saved device name (most durable — names survive restarts)
    if (user.playerName) {
      const byName = devices.find(d => d.name === user.playerName);
      if (byName) return { deviceId: byName.id, deviceName: byName.name, source: 'name_match' };
    }

    // 2. Match by saved device ID (may still be valid)
    if (user.playerid) {
      const byId = devices.find(d => d.id === user.playerid);
      if (byId) return { deviceId: byId.id, deviceName: byId.name, source: 'id_match' };
    }

    // 3. Fall back to currently active device
    const active = devices.find(d => d.is_active);
    if (active) return { deviceId: active.id, deviceName: active.name, source: 'active_device' };

    // 4. Fall back to first available device
    return { deviceId: devices[0].id, deviceName: devices[0].name, source: 'first_available' };
  }

  // 5. Saved device even though Spotify didn't list it — transfer may wake it
  if (user.playerid) {
    return { deviceId: user.playerid, deviceName: user.playerName || 'unknown', source: 'saved_fallback' };
  }
  return null;
}

/**
 * Transfer playback to a device before issuing play commands.
 * This wakes up devices that may appear offline and ensures the
 * device is ready to receive playback.
 */
async function transferPlayback(accessToken, deviceId) {
  const resp = await fetch('https://api.spotify.com/v1/me/player', {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ device_ids: [deviceId], play: false })
  });
  // 204 = success, 404 = no active device (ok to ignore)
  if (!resp.ok && resp.status !== 404) {
    const errText = await resp.text();
    throw spotifyError(`Transfer playback failed: ${resp.status} ${errText}`, resp.status);
  }
}

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
        ':src': 'tapCard'
      }
    }));
  } catch (err) {
    console.error('Failed to record last error:', err);
  }
}

function extractSpotifyTrackId(url) {
  const match = url.match(/spotify\.com\/track\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

exports.handler = async (event) => {
  const secret = event.headers && event.headers["x-internal"];
  if (secret !== process.env.INTERNAL_SECRET) {
    return { statusCode: 403, body: "Forbidden" };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  let { deviceid, cardID } = data;
  if (!deviceid || !cardID) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing deviceid or cardID" }) };
  }

  cardID = cardID.toUpperCase();

  const client = new DynamoDBClient();
  const ddbDocClient = DynamoDBDocumentClient.from(client);
  // 1. Lookup userid from devices table
  let userid;
  try {
    const deviceRes = await ddbDocClient.send(new GetCommand({
      TableName: DEVICES_TABLE,
      Key: { deviceid }
    }));
    if (!deviceRes.Item || !deviceRes.Item.userid) {
      return { statusCode: 404, body: JSON.stringify({ error: "Device not registered" }) };
    }
    userid = deviceRes.Item.userid;
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
  // 2. Lookup card record from cards table
  let card;
  try {
    const cardRes = await ddbDocClient.send(new GetCommand({
      TableName: CARDS_TABLE,
      Key: { userid, cardID }
    }));
    card = cardRes.Item;
  } catch (err) {
    const message = err.message || 'Failed to load card';
    await recordUserError(ddbDocClient, userid, message);
    return { statusCode: 500, body: JSON.stringify({ error: message }) };
  }
  // 3. Lookup user record
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
    return { statusCode: 404, body: JSON.stringify({ error: "User not found" }) };
  }
  // 4. Write lastCard and lastCardTimestamp to user record
  try {
    await ddbDocClient.send(new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { userid },
      UpdateExpression: 'SET lastCard = :cardID, lastCardTimestamp = :ts',
      ExpressionAttributeValues: {
        ':cardID': cardID,
        ':ts': Date.now()
      }
    }));
  } catch (err) {
    const message = err.message || 'Failed to update last card';
    await recordUserError(ddbDocClient, userid, message);
    return { statusCode: 500, body: JSON.stringify({ error: message }) };
  }

  if (!card) {
    return { statusCode: 200, body: JSON.stringify({ message: "Tap recorded- new card" }) };
  }

  // 5. Spotify API: get accessToken, refresh proactively if we know it expired.
  // A stale or missing expiresAt is covered by the retry-on-401 below.
  let accessToken = user.accessToken;
  let refreshToken = user.refreshToken;
  const expiresAt = user.expiresAt;
  const now = Math.floor(Date.now() / 1000);

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

  // 6. Resolve device, transfer playback, then play
  let playStatus = 'not attempted';
  let deviceSource = 'none';
  const spotifyURL = card.spotifyURL || card.spotifyUrl;
  if (accessToken && spotifyURL) {
    const playOnce = async (token) => {
      const device = await resolveDevice(token, user);
      if (!device) {
        throw spotifyError('No Spotify device available — open Spotify on a player and set it in the dashboard', 404);
      }
      deviceSource = device.source;

      // Update saved playerid if we resolved by name and the ID changed
      if (device.source === 'name_match' && device.deviceId !== user.playerid) {
        try {
          await ddbDocClient.send(new UpdateCommand({
            TableName: USERS_TABLE,
            Key: { userid },
            UpdateExpression: 'SET playerid = :pid',
            ExpressionAttributeValues: { ':pid': device.deviceId }
          }));
        } catch (_) { /* non-critical, continue */ }
      }

      // Transfer playback to wake up the device
      await transferPlayback(token, device.deviceId);

      // Play the track
      const uri = extractSpotifyTrackId(spotifyURL);
      const playResp = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${device.deviceId}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ uris: [`spotify:track:${uri}`] })
        }
      );
      if (!playResp.ok) {
        const errText = await playResp.text();
        throw spotifyError(`Spotify play failed (device: ${device.deviceName}, source: ${device.source}): ${playResp.status} ${errText}`, playResp.status);
      }
    };

    try {
      try {
        await playOnce(accessToken);
      } catch (err) {
        // The stored token can be stale even when expiresAt says otherwise —
        // refresh once and retry.
        if (err.status === 401 && refreshToken) {
          const refreshed = await refreshSpotifyToken(ddbDocClient, userid, refreshToken);
          accessToken = refreshed.accessToken;
          await playOnce(accessToken);
        } else {
          throw err;
        }
      }
      playStatus = 'success';
    } catch (err) {
      const message = 'Spotify play failed: ' + err.message;
      await recordUserError(ddbDocClient, userid, message);
      return { statusCode: 500, body: JSON.stringify({ error: message }) };
    }
  }

  return { statusCode: 200, body: JSON.stringify({ message: "Tap recorded and song played", spotifyURL, playStatus, deviceSource }) };
};
