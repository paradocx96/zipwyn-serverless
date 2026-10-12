import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = 'url-shortener-urls';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
};

export const handler = async (event) => {
    try {
        const shortCode = event.pathParameters?.shortCode;

        const result = await docClient.send(
            new GetCommand({ TableName: TABLE_NAME, Key: { shortCode } })
        );

        if (!result.Item) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'URL not found' }),
            };
        }

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                shortCode: result.Item.shortCode,
                originalUrl: result.Item.originalUrl,
                clicks: result.Item.clicks || 0,
                createdAt: result.Item.createdAt,
            }),
        };
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'Internal server error' }),
        };
    }
};
