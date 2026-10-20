const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');

/** Refresh and persist all Spotify credentials before returning them to the caller. */
async function refreshSpotifyToken(ddbDocClient, userid, refreshToken, request = fetch) {
  const params = new URLSearchParams();
  params.append('grant_type', 'refresh_token');
  params.append('refresh_token', refreshToken);
  params.append('client_id', process.env.SPOTIFY_CLIENT_ID);
  params.append('client_secret', process.env.SPOTIFY_CLIENT_SECRET);
  const resp = await request('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  }, 'Spotify token refresh', 1000); // Leave time to persist a rotated refresh token.
  if (!resp.ok) throw new Error('Failed to refresh Spotify token');
  const tokenData = await resp.json();
  const accessToken = tokenData.access_token;
  const expiresAt = Math.floor(Date.now() / 1000) + tokenData.expires_in;
  // Spotify may omit refresh_token when the existing token remains valid.
  const newRefreshToken = tokenData.refresh_token || refreshToken;
  await ddbDocClient.send(new UpdateCommand({
    TableName: process.env.USERS_TABLE,
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

module.exports = { refreshSpotifyToken };
