const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { refreshSpotifyToken } = require('/opt/spotify-token');

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 1 }));
const reply = (statusCode, data) => ({ statusCode, body: JSON.stringify(data) });

exports.handler = async event => {
  if (!process.env.INTERNAL_SECRET || event.headers?.['x-internal'] !== process.env.INTERNAL_SECRET) {
    return reply(403, { error: 'Forbidden' });
  }
  const { userid, q } = event.queryStringParameters || {};
  const query = typeof q === 'string' ? q.trim() : '';
  if (!userid || query.length < 2 || query.length > 120) {
    return reply(400, { error: 'Enter between 2 and 120 characters to search.' });
  }

  // One deadline covers database reads, refreshes, searches and response bodies.
  const signal = AbortSignal.timeout(4000);
  const db = { send: command => client.send(command, { abortSignal: signal }) };
  const request = (url, options) => fetch(url, { ...options, signal });
  try {
    const { Item: user } = await db.send(new GetCommand({
      TableName: process.env.USERS_TABLE, Key: { userid },
    }));
    if (!user) return reply(404, { error: 'User not found.' });

    let accessToken = user.accessToken;
    let refreshed = false;
    const refresh = async () => {
      const tokens = await refreshSpotifyToken(db, userid, user.refreshToken, request);
      accessToken = tokens.accessToken;
      refreshed = true;
    };
    if (user.refreshToken && (!accessToken || (user.expiresAt && Date.now() / 1000 >= user.expiresAt))) {
      await refresh();
    }
    if (!accessToken) return reply(401, { error: 'Reconnect Spotify to search for songs.' });

    const params = new URLSearchParams({ q: query, type: 'track', limit: '5' });
    const search = () => request(`https://api.spotify.com/v1/search?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    let response = await search();
    if (response.status === 401 && user.refreshToken && !refreshed) {
      await refresh();
      response = await search();
    }
    if (response.status === 429) {
      const retryAfter = Math.min(3600, Math.max(1, Number(response.headers.get('Retry-After')) || 30));
      return reply(429, { error: 'Spotify is busy. Please wait a little before searching again.', retryAfter });
    }
    if (response.status === 401 || response.status === 403) {
      return reply(response.status, { error: 'Spotify denied search access. Reconnect Spotify and try again.' });
    }
    if (!response.ok) return reply(502, { error: 'Could not search Spotify. Please try again.' });

    const data = await response.json();
    const seen = new Set();
    const tracks = (Array.isArray(data.tracks?.items) ? data.tracks.items : [])
      .filter(track => {
        if (!track?.id || !track.name || seen.has(track.id)) return false;
        seen.add(track.id);
        return true;
      })
      .map(track => ({
        id: track.id,
        name: track.name,
        artistName: (track.artists || []).map(artist => artist.name).join(', '),
        albumName: track.album?.name || '',
        imageUrl: track.album?.images?.[0]?.url || null,
        spotifyUrl: track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`,
      }));
    return reply(200, { tracks });
  } catch (err) {
    if (signal.aborted || err.name === 'AbortError' || err.name === 'TimeoutError') {
      return reply(504, { error: 'Spotify search took too long. Please try again.' });
    }
    return reply(502, { error: 'Could not search Spotify. Try again or reconnect Spotify.' });
  }
};
