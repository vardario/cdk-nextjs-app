import next from 'next';
import http from 'node:http';
import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

const EXCLUDED_RESPONSE_HEADERS = ['content-encoding', 'connection', 'keep-alive', 'transfer-encoding'];
const EXCLUDED_REQUEST_HEADERS = ['host', 'content-length', 'connection', 'accept-encoding', 'origin'];

export type Handler = (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyStructuredResultV2>;

export interface CreateNextServerHandlerProps {
  dir: string;
  basePath?: string;
}

export function createNextServerHandler({ dir, basePath }: CreateNextServerHandlerProps): Handler {
  const createNextServer = async () => {
    return new Promise<http.Server>((resolve, reject) => {
      const app = next({ dev: false, dir });
      app
        .prepare()
        .then(() => {
          const server = http.createServer(app.getRequestHandler());
          server.listen(3000, () => {
            resolve(server);
          });
        })
        .catch(reject);
    });
  };

  let server: http.Server | undefined;

  const handler: Handler = async event => {
    event.rawPath = event.rawPath.replace(basePath || '', '');
    if (!server) {
      server = await createNextServer();
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

    const response = await fetch(`http://localhost:3000/${event.rawPath}`, requestInit);
    const responseHeaders: Record<string, string> = {};

    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

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
