const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();

const USERS_TABLE = process.env.USERS_TABLE;

exports.handler = async (event) => {

  const secret = event.headers["x-internal"]

  if (secret !== process.env.INTERNAL_SECRET) {
    return { statusCode: 403, body: "Forbidden" }
  }

  let userData;
  try {
    userData = JSON.parse(event.body);
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }
  const { userid, name, email, image, accessToken, refreshToken, expiresAt } = userData;

  if (!userid) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing userid from spotify' }) };
  }

  // Check if user exists
  const getParams = {
    TableName: USERS_TABLE,
    Key: { userid }
  };

  try {
    const result = await dynamodb.get(getParams).promise();
    if (result.Item) {
      // User already exists
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

    await dynamodb.put(putParams).promise();

    return { statusCode: 201, body: JSON.stringify({ message: 'User created' }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
