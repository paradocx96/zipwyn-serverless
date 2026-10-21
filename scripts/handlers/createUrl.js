import {GetCommand, PutCommand} from '@aws-sdk/lib-dynamodb';
import {docClient, TABLE_NAME} from '../utils/dynamodb.js';
import {generateShortCode} from '../utils/shortcode.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export const handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const {url, customCode} = body;

    // Validate URL
    if (!url) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({error: 'URL is required'}),
      };
    }

    // Basic URL validation
    try {
      new URL(url);
    } catch {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({error: 'Invalid URL format'}),
      };
    }

    // Generate or use custom short code
    let shortCode = customCode || generateShortCode();

    // Check if custom code already exists
    if (customCode) {
      const existing = await docClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: {shortCode},
        })
      );

      if (existing.Item) {
        return {
          statusCode: 409,
          headers: corsHeaders,
          body: JSON.stringify({error: 'Short code already exists'}),
        };
      }
    }

    const item = {
      shortCode,
      originalUrl: url,
      createdAt: Date.now(),
      clicks: 0,
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
        ConditionExpression: 'attribute_not_exists(shortCode)',
      })
    );

    const shortUrl = `${process.env.BASE_URL}/${shortCode}`;

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify({
        shortCode,
        shortUrl,
        originalUrl: url,
        createdAt: item.createdAt,
      }),
    };
  } catch (error) {
    console.error('Error creating URL:', error);

    // Handle duplicate key error (race condition)
    if (error.name === 'ConditionalCheckFailedException') {
      return {
        statusCode: 409,
        headers: corsHeaders,
        body: JSON.stringify({error: 'Short code collision, please retry'}),
      };
    }

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({error: 'Internal server error'}),
    };
  }
};
