import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = 'url-shortener-urls';

export const handler = async (event) => {
    try {
        const shortCode = event.pathParameters?.shortCode;

        if (!shortCode || shortCode === 'favicon.ico') {
            return { statusCode: 404 };
        }

        const result = await docClient.send(
            new GetCommand({ TableName: TABLE_NAME, Key: { shortCode } })
        );

        if (!result.Item) {
            return {
                statusCode: 404,
                headers: { 'Content-Type': 'text/html' },
                body: '<html><body><h1>404 - URL not found</h1></body></html>',
            };
        }

        // Increment clicks (fire and forget)
        docClient.send(
            new UpdateCommand({
                TableName: TABLE_NAME,
                Key: { shortCode },
                UpdateExpression: 'SET clicks = if_not_exists(clicks, :zero) + :inc',
                ExpressionAttributeValues: { ':inc': 1, ':zero': 0 },
            })
        ).catch(console.error);

        return {
            statusCode: 302,
            headers: {
                Location: result.Item.originalUrl,
                'Cache-Control': 'no-cache',
            },
        };
    } catch (error) {
        console.error('Error:', error);
        return { statusCode: 500 };
    }
};
