const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, UpdateCommand, PutCommand } = require("@aws-sdk/lib-dynamodb");

const USERS_TABLE = process.env.USERS_TABLE;
const DEVICES_TABLE = process.env.DEVICES_TABLE;

if (!DEVICES_TABLE) {
  throw new Error("DEVICES_TABLE environment variable is not set");
}
if (!USERS_TABLE) {
  throw new Error("USERS_TABLE environment variable is not set");
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
        ':src': 'addDevice'
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

  const { userid, deviceid } = data;
  if (!userid || !deviceid) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing fields" }) };
  }

  const client = new DynamoDBClient();
  const ddbDocClient = DynamoDBDocumentClient.from(client);

  try {
    // Update user with deviceid
    await ddbDocClient.send(new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { userid },
      UpdateExpression: 'SET deviceid = :deviceid',
      ExpressionAttributeValues: {
        ':deviceid': deviceid
      }
    }));
    // Put device in devices table
    await ddbDocClient.send(new PutCommand({
      TableName: DEVICES_TABLE,
      Item: { deviceid, userid }
    }));
    return { statusCode: 200, body: JSON.stringify({ message: "Device ID added to user and devices table" }) };
  } catch (err) {
    const message = err.message || 'Failed to add device';
    await recordUserError(ddbDocClient, userid, message);
    return { statusCode: 500, body: JSON.stringify({ error: message }) };
  }
};
