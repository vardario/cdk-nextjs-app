import { test, describe } from 'vitest';
import { createNextServerHandler } from '../next-server-handler';
import path from 'node:path';
import { expect } from 'vitest';
import { createAwsProxyEvent } from './test-utils';

describe('NextJs Server Lambda', async () => {
  test('server handler', async () => {
    const handler = createNextServerHandler({ dir: path.resolve(__dirname, '../../example/nextjs-app') });

    const rootResponse = await handler(createAwsProxyEvent('/', 'GET'));
    expect(rootResponse.statusCode).toBe(200);
    expect(rootResponse.headers!['x-powered-by']).toBe('Next.js');
    expect(rootResponse.headers!['content-type']).toBe('text/html; charset=utf-8');

    const dynamicResponse = await handler(createAwsProxyEvent('/time', 'GET'));
    expect(dynamicResponse.statusCode).toBe(200);
    expect(dynamicResponse.headers!['x-powered-by']).toBe('Next.js');
    expect(dynamicResponse.headers!['content-type']).toBe('text/html; charset=utf-8');

    const staticResponse = await handler(createAwsProxyEvent('/static', 'GET'));
    expect(staticResponse.statusCode).toBe(200);
    expect(staticResponse.headers!['x-powered-by']).toBe('Next.js');
    expect(staticResponse.headers!['content-type']).toBe('text/html; charset=utf-8');
  });
});
