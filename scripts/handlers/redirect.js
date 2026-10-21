import {GetCommand, UpdateCommand} from '@aws-sdk/lib-dynamodb';
import {docClient, TABLE_NAME} from '../utils/dynamodb.js';

export const handler = async (event) => {
  try {
    const {shortCode} = event.pathParameters;

    // Skip favicon and other common requests
    if (shortCode === 'favicon.ico' || shortCode === 'robots.txt') {
      return {statusCode: 404};
    }

    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {shortCode},
      })
    );

    if (!result.Item) {
      return {
        statusCode: 404,
        headers: {'Content-Type': 'text/html'},
        body: '<html><body><h1>404 - URL not found</h1></body></html>',
      };
    }

    // Increment click counter asynchronously (fire and forget)
    docClient
      .send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: {shortCode},
          UpdateExpression: 'SET clicks = if_not_exists(clicks, :zero) + :inc',
          ExpressionAttributeValues: {
            ':inc': 1,
            ':zero': 0,
          },
        })
      )
      .catch((err) => console.error('Failed to update clicks:', err));

    return {
      statusCode: 302,
      headers: {
        Location: result.Item.originalUrl,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    };
  } catch (error) {
    console.error('Error redirecting:', error);
    return {
      statusCode: 500,
      headers: {'Content-Type': 'text/html'},
      body: '<html><body><h1>500 - Server error</h1></body></html>',
    };
  }
};
