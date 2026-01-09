const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

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
        ':src': 'setPlayer'
      }
    }));
  } catch (err) {
    console.error('Failed to record last error:', err);
  }
}

exports.handler = async (event) => {
  let data;
  try {
    data = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }
  const { userid, spotifyPlayerId, spotifyPlayerName } = data;
  if (!userid || !spotifyPlayerId || !spotifyPlayerName) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing fields" }) };
  }

  const client = new DynamoDBClient();
  const ddbDocClient = DynamoDBDocumentClient.from(client);

  try {
    await ddbDocClient.send(new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { userid },
      UpdateExpression: 'SET playerid = :pid, playerName = :pname',
      ExpressionAttributeValues: {
        ':pid': spotifyPlayerId,
        ':pname': spotifyPlayerName
      }
    }));
    return { statusCode: 200, body: JSON.stringify({ message: "Spotify player set" }) };
  } catch (err) {
    const message = err.message || 'Failed to set Spotify player';
    await recordUserError(ddbDocClient, userid, message);
    return { statusCode: 500, body: JSON.stringify({ error: message }) };
  }
};
