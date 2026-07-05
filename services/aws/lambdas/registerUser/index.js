const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const USERS_TABLE = process.env.USERS_TABLE;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Best-effort Telegram ping; must never fail the main flow.
async function notify(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
      signal: AbortSignal.timeout(3000)
    });
  } catch (err) {
    console.error('Telegram notify failed:', err);
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
        ':src': 'registerUser'
      }
    }));
  } catch (err) {
    console.error('Failed to record last error:', err);
  }
}

exports.handler = async (event) => {
  // Don't log the event: the body carries Spotify access/refresh tokens.
  console.log('registerUser Lambda invoked');

  const secret = event.headers["x-internal"]

  if (secret !== process.env.INTERNAL_SECRET) {
    console.log('Forbidden: Invalid internal secret');
    return { statusCode: 403, body: "Forbidden" }
  }

  const client = new DynamoDBClient();
  const ddbDocClient = DynamoDBDocumentClient.from(client);

  let userData;
  try {
    userData = JSON.parse(event.body);
  } catch (err) {
    console.log('Invalid JSON in request body');
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }
  const { userid, name, email, image, accessToken, refreshToken, expiresAt } = userData;

  if (!userid) {
    console.log('Missing userid from spotify');
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing userid from spotify' }) };
  }

  // Check if user exists
  const getParams = {
    TableName: USERS_TABLE,
    Key: { userid }
  }

  try {
    const result = await ddbDocClient.send(new GetCommand(getParams));
    if (result.Item) {
      // User exists: refresh the stored tokens so a re-login can recover
      // from a revoked or rotated refresh token.
      const updates = [];
      const values = {};
      if (accessToken) { updates.push('accessToken = :at'); values[':at'] = accessToken; }
      if (refreshToken) { updates.push('refreshToken = :rt'); values[':rt'] = refreshToken; }
      if (expiresAt) { updates.push('expiresAt = :ea'); values[':ea'] = expiresAt; }
      if (updates.length > 0) {
        await ddbDocClient.send(new UpdateCommand({
          TableName: USERS_TABLE,
          Key: { userid },
          UpdateExpression: 'SET ' + updates.join(', '),
          ExpressionAttributeValues: values
        }));
      }
      console.log('User already exists, tokens refreshed:', userid);
      await notify(`🔑 ${name || userid} signed in`);
      return { statusCode: 200, body: JSON.stringify({ message: 'User already exists' }) };
    }

    // Insert new user
    const putParams = {
      TableName: USERS_TABLE,
      Item: {
        userid,
        name,
        email,
        image,
        accessToken,
        refreshToken,
        expiresAt
      }
    };
    await ddbDocClient.send(new PutCommand(putParams))
    console.log('Inserted new user:', userid);
    await notify(`👋 New user signed up: ${name || userid} (${userid})`);
    return { statusCode: 201, body: JSON.stringify({ message: 'User created' }) };
  } catch (err) {
    console.error('DynamoDB error:', err);
    const message = err.message || 'Failed to register user';
    await recordUserError(ddbDocClient, userid, message);
    return { statusCode: 500, body: JSON.stringify({ error: message }) };
  }
};
