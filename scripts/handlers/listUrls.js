import {ScanCommand} from '@aws-sdk/lib-dynamodb';
import {docClient, TABLE_NAME} from '../utils/dynamodb.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

export const handler = async (event) => {
  try {
    const limit = parseInt(event.queryStringParameters?.limit) || 50;
    const lastKey = event.queryStringParameters?.cursor;

    const params = {
      TableName: TABLE_NAME,
      Limit: limit,
    };

    if (lastKey) {
      params.ExclusiveStartKey = JSON.parse(
        Buffer.from(lastKey, 'base64').toString()
      );
    }

    const result = await docClient.send(new ScanCommand(params));

    const response = {
      urls: result.Items.map((item) => ({
        shortCode: item.shortCode,
        shortUrl: `${process.env.BASE_URL}/${item.shortCode}`,
        originalUrl: item.originalUrl,
        clicks: item.clicks || 0,
        createdAt: item.createdAt,
      })),
    };

    if (result.LastEvaluatedKey) {
      response.nextCursor = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey)
      ).toString('base64');
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Error listing URLs:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({error: 'Internal server error'}),
    };
  }
};
