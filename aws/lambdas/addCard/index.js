const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");

const CARDS_TABLE = process.env.CARDS_TABLE;

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

  const { userid, cardID, spotifyURL } = data;
  if (!userid || !cardID || !spotifyURL) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing fields" }) };
  }

  const client = new DynamoDBClient();
  const ddbDocClient = DynamoDBDocumentClient.from(client);

  try {
    await ddbDocClient.send(new PutCommand({
      TableName: CARDS_TABLE,
      Item: { userid, cardID, spotifyURL }
    }));
    return { statusCode: 201, body: JSON.stringify({ message: "Card added" }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};