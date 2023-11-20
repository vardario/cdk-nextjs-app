import { expect, test, beforeAll, afterAll } from 'vitest';
import httpMocks from 'node-mocks-http';
import fs from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'node:querystring';
import { IncomingMessage, ServerResponse } from 'node:http';
import { NextJsImageDownloadHandler, createS3DownloadHandler, optimizeImage, handler } from './next-image-handler';
import sharp from 'sharp';
import { describe } from 'node:test';
import { StorageTestContext } from './test/storage-test-context';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { APIGatewayProxyEventV2 } from 'aws-lambda';

const testImage = fs.readFileSync(path.resolve(__dirname, '../assets/test.jpg'));

const requiredServerFilesPath = path.resolve(__dirname, './test/required-server-files.json');

const mockImageDownloadHandler: NextJsImageDownloadHandler = async (_: IncomingMessage, res: ServerResponse) => {
  res.statusCode = 200;
  res.write(testImage);
  res.end();
};

const requestImage = async (imageUrl: string, w: number, q: number) => {
  const url = `/image?${stringify({ w, q, url: imageUrl })}`;

  const req = httpMocks.createRequest({
    method: 'GET',
    url,
    params: parse(url)
  });

  const res = httpMocks.createResponse();

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { config } = require(requiredServerFilesPath);
  await optimizeImage(req, res, config, mockImageDownloadHandler);

  return res._getBuffer();
};

let context: StorageTestContext;
let bucket: string;

beforeAll(async () => {
  context = await StorageTestContext.create();
  bucket = await context.createBucket();

  await context.s3Client.send(
    new PutObjectCommand({
      Body: testImage,
      Bucket: bucket,
      ContentType: 'image/jpeg',
      Key: '_next/static/media/test.jpg'
    })
  );
});

afterAll(async () => {
  await context.destroy();
});

describe('NextJs Image Lambda', async () => {
  test('image optimizer', async () => {
    const imageBuffer0 = await requestImage('/_next/static/media/test.jpg', 640, 75);

    const imageBuffer1 = await requestImage('/_next/static/media/test.jpg', 1080, 75);

    const image0 = sharp(imageBuffer0);
    const image1 = sharp(imageBuffer1);

    const image0MetaData = await image0.metadata();
    const image1MetaData = await image1.metadata();

    expect(image0MetaData.width).toBe(640);
    expect(image1MetaData.width).toBe(1080);
  });

  test('s3 download handler', async () => {
    const testImage = fs.readFileSync(path.resolve(__dirname, '../assets/test.jpg'));

    await context.s3Client.send(
      new PutObjectCommand({
        Body: testImage,
        Bucket: bucket,
        ContentType: 'image/jpeg',
        Key: '_next/static/media/test.jpg'
      })
    );

    const downloadHandler = createS3DownloadHandler(context.s3Client, bucket);

    const req = httpMocks.createRequest();
    const res = httpMocks.createResponse();

    await downloadHandler(req, res, {
      href: '/_next/static/media/test.jpg'
    } as any);

    const s3Response = res._getBuffer();
    expect(Buffer.compare(testImage, s3Response)).toBe(0);
  });

  test('handler', async () => {
    const event: APIGatewayProxyEventV2 = {
      version: '2.0',
      routeKey: 'GET /',
      rawPath: '/',
      rawQueryString: 'url=%2F_next%2Fstatic%2Fmedia%2Ftest.jpg&w=1080&q=75',
      headers: {},
      queryStringParameters: {
        q: '75',
        url: '/_next/static/media/test.jpg',
        w: '1080'
      },
      requestContext: {
        accountId: '291069951709',
        apiId: 'ojsh2ljdn5',
        domainName: 'ojsh2ljdn5.execute-api.eu-central-1.amazonaws.com',
        domainPrefix: 'ojsh2ljdn5',
        http: {
          method: 'GET',
          path: '/image',
          protocol: 'HTTP/1.1',
          sourceIp: '80.187.86.175',
          userAgent: 'PostmanRuntime/7.32.3'
        },
        requestId: 'JFzWRj2yliAEMOw=',
        routeKey: 'GET /',
        stage: '$default',
        time: '03/Aug/2023:15:47:51 +0000',
        timeEpoch: 1691077671852
      },
      isBase64Encoded: false
    };

    process.env.NEXT_REQUIRED_SERVER_FILES = requiredServerFilesPath;
    process.env.NEXT_BUILD_BUCKET = bucket;

    const response = await handler(
      event,
      null as any,
      null as any,

      context.s3Client
    );

    const imageBuffer = Buffer.from(response.body!, 'base64');
    const imageMeta = await sharp(imageBuffer).metadata();
    expect(imageMeta.width).toBe(1080);
  });
});
