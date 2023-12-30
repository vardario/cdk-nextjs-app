import next from 'next';
import http from 'node:http';
import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

const EXCLUDED_RESPONSE_HEADERS = ['content-encoding', 'connection', 'keep-alive', 'transfer-encoding'];

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

    const response = await fetch(`http://localhost:3000/${event.rawPath}`);
    const headers: Record<string, string> = {};

    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    EXCLUDED_RESPONSE_HEADERS.forEach(header => delete headers[header]);

    return {
      statusCode: 200,
      body: await response.text(),
      headers
    };
  };

  return handler;
}

export const handler = createNextServerHandler({
  dir: process.env.NEXT_APP_PATH!,
  basePath: process.env.SERVER_ENDPOINT!
});
