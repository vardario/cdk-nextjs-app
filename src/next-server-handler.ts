import next from 'next';
import serverlessExpress from '@codegenie/serverless-express';

export function createNextServerHandler(dir: string) {
  const app = next({
    dev: false,
    dir,
    customServer: false
  });

  return serverlessExpress({ app: app.getRequestHandler() });
}

export const handler = createNextServerHandler(process.env.NEXT_APP_PATH!);
