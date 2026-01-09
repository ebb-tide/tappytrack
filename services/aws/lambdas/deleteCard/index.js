const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, DeleteCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const CARDS_TABLE = process.env.CARDS_TABLE;
const USERS_TABLE = process.env.USERS_TABLE;

async function recordUserError(ddbDocClient, userid, message) {
  if (!USERS_TABLE || !userid) return;
  try {
    await ddbDocClient.send(new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { userid },
      UpdateExpression: 'SET lastErrorMessage = :msg, lastErrorAt = :ts, lastErrorSource = :src',
      ConditionExpression: 'attribute_exists(userid)',
      ExpressionAttributeValues: {
        ':msg': message,
        ':ts': Date.now(),
        ':src': 'deleteCard'
      }
    }));
  } catch (err) {
    console.error('Failed to record last error:', err);
  }
}

exports.handler = async (event) => {
  const secret = event.headers["x-internal"];
  if (secret !== process.env.INTERNAL_SECRET) {
    return { statusCode: 403, body: "Forbidden" };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  let { userid, cardID } = data;
  if (!userid || !cardID) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing fields" }) };
  }
  
  cardID = cardID.toUpperCase();

  const client = new DynamoDBClient();
  const ddbDocClient = DynamoDBDocumentClient.from(client);

  try {
    await ddbDocClient.send(new DeleteCommand({
      TableName: CARDS_TABLE,
      Key: { userid, cardID }
    }));
    return { statusCode: 200, body: JSON.stringify({ message: "Card deleted" }) };
  } catch (err) {
    const message = err.message || 'Failed to delete card';
    await recordUserError(ddbDocClient, userid, message);
    return { statusCode: 500, body: JSON.stringify({ error: message }) };
  }
};
