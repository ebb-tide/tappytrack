const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const fetch = require("node-fetch");

const DEVICES_TABLE = process.env.DEVICES_TABLE;
const CARDS_TABLE = process.env.CARDS_TABLE;
const USERS_TABLE = process.env.USERS_TABLE;
const PLAYER_ID= "92aea6c4165c29ecb355eb798c86571e82ef1fe0";

function extractSpotifyTrackId(url) {
  const match = url.match(/spotify\.com\/track\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

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
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
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
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
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
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
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
        return { statusCode: 500, body: JSON.stringify({ error: 'Spotify token refresh failed: ' + err.message }) };
      }
    }

    // 6. Play the song on the specified device using Spotify API
    let playStatus = 'not attempted';
    if (accessToken && (card.spotifyURL || card.spotifyUrl)) {
      try {
        const spotifyURL = card.spotifyURL || card.spotifyUrl;
        const uri = extractSpotifyTrackId(spotifyURL)
        const playResp = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${user.playerid || PLAYER_ID}`,
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
          throw new Error(`Spotify play failed: ${playResp.status} ${errText}`);
        }
        playStatus = 'success';
      } catch (err) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Spotify play failed: ' + err.message }) };
      }
    }

    return { statusCode: 200, body: JSON.stringify({ message: "Tap recorded and song played", spotifyURL: card.spotifyURL || card.spotifyUrl, playStatus }) };
  }
  return { statusCode: 200, body: JSON.stringify({ message: "Tap recorded- new card" }) };

};
