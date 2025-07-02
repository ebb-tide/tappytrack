const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const USERS_TABLE = process.env.USERS_TABLE;

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
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
