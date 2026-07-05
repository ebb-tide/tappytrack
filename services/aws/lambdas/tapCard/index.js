const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const fetch = require("node-fetch");

const DEVICES_TABLE = process.env.DEVICES_TABLE;
const CARDS_TABLE = process.env.CARDS_TABLE;
const USERS_TABLE = process.env.USERS_TABLE;
const PLAYER_ID= "92aea6c4165c29ecb355eb798c86571e82ef1fe0";

/**
 * Resolve the best available Spotify device for playback.
 * Strategy:
 *   1. Match by saved device name (names are stable across sessions, unlike IDs)
 *   2. Match by saved device ID (in case it's still valid)
 *   3. Fall back to whichever device is currently active
 *   4. Fall back to the first available device
 *   5. Fall back to the hardcoded PLAYER_ID constant
 * Returns { deviceId, deviceName, source } or null if no devices at all.
 */
async function resolveDevice(accessToken, user) {
  let devices = [];
  try {
    const resp = await fetch('https://api.spotify.com/v1/me/player/devices', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (resp.ok) {
      const data = await resp.json();
      devices = data.devices || [];
    }
  } catch (err) {
    // If device fetch fails, fall through to hardcoded fallback
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

  // 5. Last resort: hardcoded fallback
  if (user.playerid) {
    return { deviceId: user.playerid, deviceName: user.playerName || 'unknown', source: 'saved_fallback' };
  }
  return { deviceId: PLAYER_ID, deviceName: 'hardcoded_default', source: 'hardcoded_fallback' };
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
    throw new Error(`Transfer playback failed: ${resp.status} ${errText}`);
  }
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
    // if (!card) {
      // return { statusCode: 404, body: JSON.stringify({ error: "Card not found" }) };
    // }
  } catch (err) {
    const message = err.message || 'Failed to load card';
    await recordUserError(ddbDocClient, userid, message);
    return { statusCode: 500, body: JSON.stringify({ error: message }) };
  }
  // 3. Lookup user record and log it
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

  // 5. Spotify API: get accessToken, refresh if needed, fetch devices
  let accessToken = user.accessToken;
  let refreshToken = user.refreshToken;
  let expiresAt = user.expiresAt;
  const now = Math.floor(Date.now() / 1000);

  if (card){
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

    // 6. Resolve device, transfer playback, then play
    let playStatus = 'not attempted';
    let deviceSource = 'none';
    if (accessToken && (card.spotifyURL || card.spotifyUrl)) {
      try {
        // Resolve the best available device
        const device = await resolveDevice(accessToken, user);
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
        await transferPlayback(accessToken, device.deviceId);

        // Play the track
        const spotifyURL = card.spotifyURL || card.spotifyUrl;
        const uri = extractSpotifyTrackId(spotifyURL);
        const playResp = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${device.deviceId}`,
          {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ uris: [`spotify:track:${uri}`] })
          }
        );
        if (!playResp.ok) {
          const errText = await playResp.text();
          throw new Error(`Spotify play failed (device: ${device.deviceName}, source: ${device.source}): ${playResp.status} ${errText}`);
        }
        playStatus = 'success';
      } catch (err) {
        const message = 'Spotify play failed: ' + err.message;
        await recordUserError(ddbDocClient, userid, message);
        return { statusCode: 500, body: JSON.stringify({ error: message }) };
      }
    }

    return { statusCode: 200, body: JSON.stringify({ message: "Tap recorded and song played", spotifyURL: card.spotifyURL || card.spotifyUrl, playStatus, deviceSource }) };
  }
  return { statusCode: 200, body: JSON.stringify({ message: "Tap recorded- new card" }) };

};
