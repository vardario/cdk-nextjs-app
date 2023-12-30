import { APIGatewayProxyEventV2 } from 'aws-lambda';

export function createAwsProxyEvent(path: string, method: string): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: path,
    rawQueryString: '',
    cookies: ['cookie1', 'cookie2'],
    headers: {
      Header1: 'value1',
      Header2: 'value1,value2'
    },
    queryStringParameters: {},
    requestContext: {
      accountId: '123456789012',
      apiId: 'api-id',
      authentication: {
        clientCert: {
          clientCertPem: 'CERT_CONTENT',
          subjectDN: 'www.example.com',
          issuerDN: 'Example issuer',
          serialNumber: 'a1:a1:a1:a1:a1:a1:a1:a1:a1:a1:a1:a1:a1:a1:a1:a1',
          validity: {
            notBefore: 'May 28 12:30:02 2019 GMT',
            notAfter: 'Aug  5 09:36:04 2021 GMT'
          }
        }
      },
      domainName: 'localhost',
      domainPrefix: 'id',
      http: {
        method,
        path,
        protocol: 'HTTP/1.1',
        sourceIp: '192.168.0.1/32',
        userAgent: 'agent'
      },
      requestId: 'id',
      routeKey: '$default',
      stage: '$default',
      time: '12/Mar/2020:19:03:58 +0000',
      timeEpoch: 1583348638390
    },
    pathParameters: {},
    isBase64Encoded: false,
    stageVariables: {
      stageVariable1: 'value1',
      stageVariable2: 'value2'
    }
  };
}
