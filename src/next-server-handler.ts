import { IncomingMessage, ServerResponse } from 'http';
import NextServer, { Options } from 'next/dist/server/next-server';
import path from 'path';
import slsHttp from 'serverless-http';

process.env.NODE_ENV = 'production';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const requiredServerFiles = require('/opt/.next/required-server-files.json');

const config: Options = {
  hostname: 'localhost',
  port: Number(process.env.PORT) || 3000,
  dir: path.join('/opt'),
  dev: false,
  customServer: false,
  conf: requiredServerFiles.config
};

const getErrMessage = (e: any) => ({ message: 'Server failed to respond.', details: e });
const nextRequestHandler = new NextServer(config).getRequestHandler();

export const handler = slsHttp(
  async (req: IncomingMessage, res: ServerResponse) => {
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
