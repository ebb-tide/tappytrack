const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");

const USERS_TABLE = process.env.USERS_TABLE;
const CARDS_TABLE = process.env.CARDS_TABLE;

exports.handler = async (event) => {
  console.log('getUserCards Lambda invoked');
  console.log('Event:', JSON.stringify(event));

  const secret = event.headers["x-internal"];
  if (secret !== process.env.INTERNAL_SECRET) {
    console.log('Forbidden: Invalid internal secret');
    return { statusCode: 403, body: "Forbidden" };
  }

  const client = new DynamoDBClient();
  const ddbDocClient = DynamoDBDocumentClient.from(client);

  const userid = event.queryStringParameters && event.queryStringParameters.userid;
  if (!userid) {
    console.log('Missing userid parameter');
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing userid parameter' })
    };
  }

  // 1. Get user from USERS_TABLE
  let user;
  try {
    const userResult = await ddbDocClient.send(new GetCommand({
      TableName: USERS_TABLE,
      Key: { userid }
    }));
    user = userResult.Item;
    if (!user) {
      return { statusCode: 404, body: JSON.stringify({ error: 'User not found' }) };
    }
  } catch (err) {
    console.error('DynamoDB get user error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }

  // 2. Check last card timestamp
  let lastCard = null;
  if (user.lastCard && user.lastCardTimestamp) {
    const now = Date.now();
    const lastCardTime = typeof user.lastCardTimestamp === 'number' ? user.lastCardTimestamp : Number(user.lastCardTimestamp);
    if (!isNaN(lastCardTime) && (now - lastCardTime) <= 30 * 60 * 1000) { // 30 minutes in ms
      lastCard = user.lastCard;
    }
  }

  // 3. Query cards table for all cards for this user
  let cards = [];
  try {
    const cardsResult = await ddbDocClient.send(new QueryCommand({
      TableName: CARDS_TABLE,
      KeyConditionExpression: 'userid = :userid',
      ExpressionAttributeValues: {
        ':userid': userid
      }
    }));
    cards = (cardsResult.Items || []).map(card => ({
      id: card.cardID || card.id,
      spotifyUrl: card.spotifyURL || card.spotifyUrl
    }));
  } catch (err) {
    console.error('DynamoDB query cards error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ cards, lastCard })
  };
};
