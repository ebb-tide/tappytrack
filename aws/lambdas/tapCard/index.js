const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const DEVICES_TABLE = process.env.DEVICES_TABLE;
const CARDS_TABLE = process.env.CARDS_TABLE;
const USERS_TABLE = process.env.USERS_TABLE;

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

  const { deviceid, cardID } = data;
  if (!deviceid || !cardID) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing deviceid or cardID" }) };
  }

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
    if (!card) {
      return { statusCode: 404, body: JSON.stringify({ error: "Card not found" }) };
    }
    console.log("Spotify URL:", card.spotifyURL || card.spotifyUrl);
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
    console.log("User record:", user);
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

  return { statusCode: 200, body: JSON.stringify({ message: "Tap recorded", spotifyURL: card.spotifyURL || card.spotifyUrl }) };
};
