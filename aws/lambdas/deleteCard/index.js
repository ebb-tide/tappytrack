const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, DeleteCommand } = require("@aws-sdk/lib-dynamodb");

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

  const { userid, cardID } = data;
  if (!userid || !cardID) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing fields" }) };
  }

  const client = new DynamoDBClient();
  const ddbDocClient = DynamoDBDocumentClient.from(client);

  try {
    await ddbDocClient.send(new DeleteCommand({
      TableName: CARDS_TABLE,
      Key: { userid, cardID }
    }));
    return { statusCode: 200, body: JSON.stringify({ message: "Card deleted" }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
