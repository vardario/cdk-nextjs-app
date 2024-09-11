import next from 'next';
import http, { IncomingMessage, ServerResponse } from 'node:http';
import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { NextServer } from 'next/dist/server/next';

const EXCLUDED_RESPONSE_HEADERS = ['content-encoding', 'connection', 'keep-alive', 'transfer-encoding'];
const EXCLUDED_REQUEST_HEADERS = ['host', 'content-length', 'connection', 'accept-encoding', 'origin'];

export type Handler = (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyStructuredResultV2>;

const createHttpServer = async (handler: (req: IncomingMessage, res: ServerResponse) => void) => {
  return new Promise<http.Server>((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(undefined, () => {
      resolve(server);
    });
    server.on('error', reject);
  });
};

export interface CreateNextServerHandlerProps {
  dir: string;
  basePath?: string;
}

let nextServer: NextServer | undefined;

export function createNextServerHandler({ dir, basePath }: CreateNextServerHandlerProps): Handler {
  const createNextServer = async () => {
    return new Promise<NextServer>((resolve, reject) => {
      const nextServer = next({ dev: false, dir });
      nextServer
        .prepare()
        .then(() => {
          resolve(nextServer);
        })
        .catch(reject);
    });
  };

  const handler: Handler = async event => {
    event.rawPath = event.rawPath.replace(basePath || '', '');
    if (!nextServer) {
      nextServer = await createNextServer();
    }

    const requestHeaders = new Headers();

    Object.entries(event.headers).forEach(([key, value]) => {
      value && !EXCLUDED_REQUEST_HEADERS.includes(key) && requestHeaders.set(key, value);
    });

    const requestInit: RequestInit = {
      headers: requestHeaders,
      method: event.requestContext.http.method,
      body: event.body
    };

    const server = await createHttpServer(nextServer.getRequestHandler());
    const address = server.address();

    if (address === null || typeof address === 'string') {
      throw new Error('Server address is not available');
    }
    const response = await fetch(`http://localhost:${address.port}/${event.rawPath}`, requestInit);
    await server.close();
    const responseHeaders: Record<string, string> = {};

    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    if (responseHeaders['cache-control'] === 's-maxage=31536000, stale-while-revalidate') {
      responseHeaders['cache-control'] = 'public, max-age=0, must-revalidate';
    }

    EXCLUDED_RESPONSE_HEADERS.forEach(header => delete responseHeaders[header]);

    return {
      statusCode: response.status,
      body: await response.text(),
      headers: responseHeaders
    };
  };

  return handler;
}

export const handler = createNextServerHandler({
  dir: process.env.NEXT_APP_PATH!,
  basePath: process.env.SERVER_ENDPOINT!
});
