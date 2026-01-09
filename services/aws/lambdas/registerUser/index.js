const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require("@aws-sdk/lib-dynamodb");

const USERS_TABLE = process.env.USERS_TABLE;

exports.handler = async (event) => {
  console.log('registerUser Lambda invoked');
  console.log('Event:', JSON.stringify(event));

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
    console.log('DynamoDB get result:', JSON.stringify(result));
    if (result.Item) {
      // User already exists
      console.log('User already exists:', userid);
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
    return { statusCode: 201, body: JSON.stringify({ message: 'User created' }) };
  } catch (err) {
    console.error('DynamoDB error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
