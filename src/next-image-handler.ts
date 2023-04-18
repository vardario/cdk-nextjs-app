import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { imageOptimizer, ImageOptimizerCache } from 'next/dist/server/image-optimizer';
import { NextUrlWithParsedQuery } from 'next/dist/server/request-meta';
import { IncomingMessage, ServerResponse } from 'node:http';
import https from 'node:https';
import { parse } from 'node:querystring';
import slsHttp from 'serverless-http';

const requiredServerFiles = require('/opt/.next/required-server-files.json');
const nextConfig = requiredServerFiles.config;
const s3 = new S3Client({});

const downloadHandler = async (req: IncomingMessage, res: ServerResponse, parsedUrl?: NextUrlWithParsedQuery) => {
  return new Promise<void>(async (resolve, reject) => {
    if (parsedUrl?.href.toLowerCase().match(/^https?:\/\//)) {
      https.get(parsedUrl?.href, (downloadRes) => {
        downloadRes
          .pipe(res)
          .once('close', () => {
            res.statusCode = 200;
            res.end();
          })
          .once('error', (err) => {
            console.error('Failed to get image', { err });
            res.statusCode = 400;
            res.end();
          });
        resolve();
        return;
      });
    }

    const s3Key = parsedUrl?.href.replace(/^\//, '');
    const response = await s3.send(new GetObjectCommand({ Bucket: process.env.NEXT_BUILD_BUCKET, Key: s3Key }));

    if (!response.Body) {
      reject('Body is empty');
      return;
    }

    res.statusCode = 200;
    res.write(Buffer.from(await response.Body.transformToByteArray()));
    res.end();
    resolve();
  });
};

export const handler = slsHttp(
  async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url!.replace(/^.+\?/, '');
    const parsedUrl = parse(url);
    const imageParams = ImageOptimizerCache.validateParams(req, parsedUrl, nextConfig, false);

    if ('errorMessage' in imageParams) {
      res.setHeader('Content-Type', 'text/plain');
      res.write(imageParams.errorMessage + '\n');
      res.write(url + '\n');
      res.statusCode = 500;
      res.end();
      return;
    }

    const result = await imageOptimizer(req, res, imageParams, nextConfig, false, downloadHandler);

    res.setHeader('Vary', 'Accept');
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control','public, max-age=315360000, immutable')
    res.statusCode = 200;
    res.write(result.buffer, 'binary');
    res.end();
  },
  {
    binary: true,
    provider: 'aws',
    basePath: '/image',
  }
);
