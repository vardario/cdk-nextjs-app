import { IncomingMessage, ServerResponse } from 'http';
import NextServer, { NodeRequestHandler, Options } from 'next/dist/server/next-server';

import slsHttp from 'serverless-http';
import fs from 'node:fs';
import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
process.env.NODE_ENV = 'production';

const getErrMessage = (e: any) => ({ message: 'Server failed to respond.', details: e });

const getNextRequestHandler = () => {
  const requiredServerFiles = JSON.parse(fs.readFileSync(process.env.NEXT_REQUIRED_SERVER_FILES!).toString());

  const config: Options = {
    hostname: 'localhost',
    port: Number(process.env.PORT) || 3000,
    dir: process.env.NEXT_APP_PATH,
    dev: false,
    customServer: false,
    conf: requiredServerFiles.config
  };

  return new NextServer(config).getRequestHandler();
};

let nextRequestHandler: NodeRequestHandler | undefined;

export const handler = async (
  event: APIGatewayProxyEventV2,
  context: any,
  _: any
): Promise<APIGatewayProxyStructuredResultV2> => {
  const _handler = slsHttp(
    async (req: IncomingMessage, res: ServerResponse) => {
      if (!nextRequestHandler) {
        nextRequestHandler = getNextRequestHandler();
      }

      await nextRequestHandler(req, res).catch(e => {
        console.error('NextJS request failed due to:');
        console.error(e);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(getErrMessage(e), null, 3));
      });
    },
    {
      binary: true,
      provider: 'aws',
      basePath: '/server'
    }
  );

  return _handler(event, context);
};
