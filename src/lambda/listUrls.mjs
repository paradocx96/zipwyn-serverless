import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = 'url-shortener-urls';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
};

export const handler = async (event) => {
    try {
        const limit = parseInt(event.queryStringParameters?.limit) || 50;
        const baseUrl = process.env.BASE_URL || `https://${event.requestContext.domainName}`;

        const result = await docClient.send(
            new ScanCommand({ TableName: TABLE_NAME, Limit: limit })
        );

        const urls = (result.Items || []).map((item) => ({
            shortCode: item.shortCode,
            shortUrl: `${baseUrl}/${item.shortCode}`,
            originalUrl: item.originalUrl,
            clicks: item.clicks || 0,
            createdAt: item.createdAt,
        }));

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ urls }),
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
