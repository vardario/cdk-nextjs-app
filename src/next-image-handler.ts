import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { NextConfigComplete } from 'next/dist/server/config-shared';
import { imageOptimizer, ImageOptimizerCache } from 'next/dist/server/image-optimizer';
import { NextUrlWithParsedQuery } from 'next/dist/server/request-meta';
import { IncomingMessage, ServerResponse } from 'node:http';
import https from 'node:https';
import { parse } from 'node:querystring';
import slsHttp from 'serverless-http';
import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import fs from 'node:fs';

export type NextJsImageDownloadHandler = (
  newReq: IncomingMessage,
  newRes: ServerResponse,
  newParsedUrl?: NextUrlWithParsedQuery
) => Promise<void>;

export const createS3DownloadHandler = (client: S3Client, s3BucketName: string) => {
  return async (req: IncomingMessage, res: ServerResponse, parsedUrl?: NextUrlWithParsedQuery) => {
    return new Promise<void>((resolve, reject) => {
      if (parsedUrl?.href.toLowerCase().match(/^https?:\/\//)) {
        https.get(parsedUrl?.href, downloadRes => {
          downloadRes
            .pipe(res)
            .once('close', () => {
              res.statusCode = 200;
              res.end();
            })
            .once('error', err => {
              console.error('Failed to get image', { err });
              res.statusCode = 400;
              res.end();
            });
          resolve();
          return;
        });
      }

      const s3Key = parsedUrl?.href.replace(/^\//, '');
      client
        .send(
          new GetObjectCommand({
            Bucket: s3BucketName,
            Key: s3Key
          })
        )
        .then(async response => {
          if (!response.Body) {
            reject('Body is empty');
            return;
          }

          try {
            res.statusCode = 200;
            res.write(Buffer.from(await response.Body.transformToByteArray()));
            res.end();
            resolve();
          } catch (error) {
            reject(error);
          }
        })
        .catch(error => {
          reject(error);
        });
    });
  };
};

export async function optimizeImage(
  req: IncomingMessage,
  res: ServerResponse,
  config: NextConfigComplete,
  imageDownloadHandler: NextJsImageDownloadHandler
) {
  const url = req.url!.replace(/^.+\?/, '');
  const parsedUrl = parse(url);
  const imageParams = ImageOptimizerCache.validateParams(req, parsedUrl, config, false);

  if ('errorMessage' in imageParams) {
    res.setHeader('Content-Type', 'text/plain');
    res.write(imageParams.errorMessage + '\n');
    res.write(url + '\n');
    res.statusCode = 500;
    res.end();
    return;
  }

  const result = await imageOptimizer(req, res, imageParams, config, false, imageDownloadHandler);

  res.setHeader('Vary', 'Accept');
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Cache-Control', 'public, max-age=315360000, immutable');
  res.statusCode = 200;
  res.write(result.buffer, 'binary');
  res.end();
}

export const handler = async (
  event: APIGatewayProxyEventV2,
  context: any,
  callback: any,
  s3Client?: S3Client
): Promise<APIGatewayProxyStructuredResultV2> => {
  const _handler = slsHttp(
    async (req: IncomingMessage, res: ServerResponse) => {
      const { config } = JSON.parse(
        fs
          .readFileSync(process.env.NEXT_REQUIRED_SERVER_FILES || '/opt/.next/required-server-files.json')
          .toString('utf-8')
      );

      await optimizeImage(
        req,
        res,
        config,
        createS3DownloadHandler(s3Client || new S3Client({}), process.env.NEXT_BUILD_BUCKET!)
      );
    },
    {
      binary: true,
      provider: 'aws',
      basePath: '/image'
    }
  );

  return _handler(event, context);
};
