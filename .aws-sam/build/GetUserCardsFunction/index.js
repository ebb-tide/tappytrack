const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();

const CARDS_TABLE = process.env.CARDS_TABLE;

exports.handler = async (event) => {

    const secret = event.headers["x-internal"]

  if (secret !== process.env.INTERNAL_SECRET) {
    return { statusCode: 403, body: "Forbidden" }
  }
  
  const userid = event.queryStringParameters && event.queryStringParameters.userid;
  if (!userid) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing userid parameter' })
    };
  }

  const params = {
    TableName: CARDS_TABLE,
    KeyConditionExpression: 'userid = :userid',
    ExpressionAttributeValues: {
      ':userid': userid
    }
  };

  try {
    const data = await dynamodb.query(params).promise();
    return {
      statusCode: 200,
      body: JSON.stringify(data.Items)
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
