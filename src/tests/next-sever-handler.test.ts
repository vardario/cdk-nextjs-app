import { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { test, describe } from 'vitest';
import { handler } from '../next-server-handler';
import path from 'node:path';
import { expect } from 'vitest';

describe('NextJs Server Lambda', async () => {
  test('server handler', async () => {
    const event: APIGatewayProxyEventV2 = {
      version: '2.0',
      routeKey: 'GET /',
      rawPath: '/',
      rawQueryString: '',
      headers: {},
      queryStringParameters: {},
      requestContext: {
        accountId: '291069951709',
        apiId: 'ojsh2ljdn5',
        domainName: 'ojsh2ljdn5.execute-api.eu-central-1.amazonaws.com',
        domainPrefix: 'ojsh2ljdn5',
        http: {
          method: 'GET',
          path: '/server',
          protocol: 'HTTP/1.1',
          sourceIp: '80.187.86.175',
          userAgent: 'PostmanRuntime/7.32.3'
        },
        requestId: 'JFzWRj2yliAEMOw=',
        routeKey: 'GET /server',
        stage: '$default',
        time: '03/Aug/2023:15:47:51 +0000',
        timeEpoch: 1691077671852
      },
      isBase64Encoded: false
    };

    process.env.NEXT_APP_PATH = path.resolve(__dirname, '../../example/nextjs-app');

    const response = await handler(event, {} as Context, () => {});
    expect(response.statusCode).toBe(200);
    expect(response.headers!['x-powered-by']).toBe('Next.js');
    expect(response.headers!['content-type']).toBe('text/html; charset=utf-8');
  });
});
