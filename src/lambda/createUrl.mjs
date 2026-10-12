import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = 'url-shortener-urls';

// Simple nanoid alternative
const generateShortCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 7; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
};

export const handler = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const { url, customCode } = body;

        if (!url) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'URL is required' }),
            };
        }

        // Validate URL
        try {
            new URL(url);
        } catch {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ error: 'Invalid URL format' }),
            };
        }

        let shortCode = customCode || generateShortCode();

        // Check if custom code exists
        if (customCode) {
            const existing = await docClient.send(
                new GetCommand({ TableName: TABLE_NAME, Key: { shortCode } })
            );
            if (existing.Item) {
                return {
                    statusCode: 409,
                    headers: corsHeaders,
                    body: JSON.stringify({ error: 'Short code already exists' }),
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

        const baseUrl = process.env.BASE_URL || `https://${event.requestContext.domainName}`;

        return {
            statusCode: 201,
            headers: corsHeaders,
            body: JSON.stringify({
                shortCode,
                shortUrl: `${baseUrl}/${shortCode}`,
                originalUrl: url,
                createdAt: item.createdAt,
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
