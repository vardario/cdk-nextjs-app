import { NpmLayerVersion } from '@apimda/npm-layer-version';

import { Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import fs from 'fs';
import * as path from 'path';

import * as cdk from 'aws-cdk-lib';
import * as cf from 'aws-cdk-lib/aws-cloudfront';
import * as cfo from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cm from 'aws-cdk-lib/aws-certificatemanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as r53 from 'aws-cdk-lib/aws-route53';
import * as r53t from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3d from 'aws-cdk-lib/aws-s3-deployment';
import * as apigw from '@aws-cdk/aws-apigatewayv2-alpha';
import * as apigwInt from '@aws-cdk/aws-apigatewayv2-integrations-alpha';

import {
  LAMBDA_ARCHITECTURE,
  LAMBDA_ESBUILD_EXTERNAL_AWS_SDK,
  LAMBDA_ESBUILD_TARGET,
  LAMBDA_RUNTIME,
  hashFolder
} from './stack-utils';
import { IMAGE_ENDPOINT, SERVER_ENDPOINT } from './utils';

export interface NextJsAppDomain {
  /**
   * Fully qualified domain name under which the NextJS  will be available.
   */
  name: string;

  /**
   * Aliases under which the app is also available.
   * The given certificate has to support the additional aliases as well.
   */
  aliases?: string[];

  /**
   * ARN to a certificate which will be used for the underlying CloudFront distribution.
   *
   * Remarks
   *  1. Certificate has to be deployed in us-east-1
   *  2. Certificate has to be compatible with the given @see domainName .
   */
  domainCertificateArn: string;

  /**
   * Reference to a hosted zone compatible with the given @see domainName .
   */
  hostedZone: r53.IHostedZone;
}

export interface NextJsAppProps {
  /**
   * Path to NextJs project
   */
  nextJsPath: string;

  /**
   * When defined, a custom domain will be attached to the
   * underlying CloudFront distribution.
   * @see NextJsAppDomain for more details.
   */
  domain?: NextJsAppDomain;

  /**
   * Provisioned concurrent executions for the NextJS server lambda.
   */
  provisionedConcurrentExecutions?: number;

  /**
   * Allowed cache headers for the NextJS server lambda.
   */
  allowedCacheHeaders?: string[];

  /**
   * NextJS server environment variables
   */
  readonly nextServerEnvironment?: Record<string, string>;

  /**
   * Path to a @NpmLayerVersion compatible directory,
   * which includes a package.json file with all needed packages.
   */
  nextAppLayerPath?: string;

  /**
   * Path to a @NpmLayerVersion compatible directory,
   * which includes a package.json file with all needed packages.
   */
  sharpLayerPath?: string;

  /**
   * Here you can define additional paths which should be cached by CloudFront.
   */
  additionalCachingPaths?: string[];
}

const NEXT_APP_PATH = '/opt';

export class NextJsApp extends Construct {
  private readonly stackProps: NextJsAppProps;
  private readonly buildId: string;
  public readonly appUrl: string;
  public readonly cloudFrontUrl: string;
  public readonly cloudfrontDistribution: cf.Distribution;

  constructor(scope: Construct, id: string, stackProps: NextJsAppProps) {
    super(scope, id);

    this.stackProps = stackProps;

    if (!fs.existsSync(stackProps.nextJsPath) || !fs.lstatSync(stackProps.nextJsPath).isDirectory()) {
      throw new Error('Next build folder not found. Did you forgot to build ?');
    }

    this.buildId = hashFolder(stackProps.nextJsPath);

    const staticAssetsBucket = this.createStaticAssetsBucket(
      (stackProps.domain && stackProps.domain.name) || undefined
    );
    const api = this.createNextServer(staticAssetsBucket);
    this.cloudfrontDistribution = this.createCloudFrontDistribution(staticAssetsBucket, api);
    this.cloudFrontUrl = `https://${this.cloudfrontDistribution.domainName}`;
    this.appUrl = (this.stackProps.domain && `https://${this.stackProps.domain.name}`) || this.cloudFrontUrl;
  }

  private createNextServer(staticAssetsBucket: s3.Bucket) {
    const nextLayer = new NpmLayerVersion(this, 'LayerNext', {
      layerPath: this.stackProps.nextAppLayerPath || path.resolve(__dirname, '../layers/next-layer'),
      layerVersionProps: {
        compatibleArchitectures: [LAMBDA_ARCHITECTURE],
        compatibleRuntimes: [lambda.Runtime.NODEJS_18_X]
      }
    });

    const sharpLayer = new NpmLayerVersion(this, 'LayerSharp', {
      layerPath: this.stackProps.sharpLayerPath || path.resolve(__dirname, '../layers/sharp-layer'),
      layerVersionProps: {
        compatibleArchitectures: [LAMBDA_ARCHITECTURE],
        compatibleRuntimes: [lambda.Runtime.NODEJS_18_X]
      }
    });

    const serverLayerVersion = new lambda.LayerVersion(this, 'NextJsDeploymentLayer', {
      code: lambda.Code.fromAsset(this.stackProps.nextJsPath, {
        exclude: ['**', '*.', '!.next', '!.next/*', '!.next/**/*', '.next/cache', '.next/static/media']
      })
    });

    const serverLambda = new lambdaNode.NodejsFunction(this, 'NextJsServerLambda', {
      currentVersionOptions: this.stackProps.provisionedConcurrentExecutions
        ? {
            provisionedConcurrentExecutions: this.stackProps.provisionedConcurrentExecutions
          }
        : undefined,
      runtime: LAMBDA_RUNTIME,
      architecture: LAMBDA_ARCHITECTURE,
      timeout: cdk.Duration.seconds(29),
      layers: [serverLayerVersion, nextLayer.layerVersion],
      memorySize: 512,
      entry: path.resolve(__dirname, 'next-server-handler.js'),
      environment: {
        ...this.stackProps.nextServerEnvironment,
        NEXT_APP_PATH,
        SERVER_ENDPOINT
      },
      bundling: {
        minify: false,
        target: LAMBDA_ESBUILD_TARGET,
        externalModules: [LAMBDA_ESBUILD_EXTERNAL_AWS_SDK, ...nextLayer.packagedDependencies]
      }
    });

    const imageLambda = new lambdaNode.NodejsFunction(this, 'NextJsImageLambda', {
      runtime: LAMBDA_RUNTIME,
      architecture: LAMBDA_ARCHITECTURE,
      timeout: cdk.Duration.seconds(29),
      layers: [serverLayerVersion, nextLayer.layerVersion, sharpLayer.layerVersion],
      environment: {
        NEXT_BUILD_BUCKET: staticAssetsBucket.bucketName,
        NEXT_APP_PATH,
        IMAGE_ENDPOINT
      },
      memorySize: 512,
      entry: path.resolve(__dirname, 'next-image-handler.js'),
      bundling: {
        minify: false,
        target: LAMBDA_ESBUILD_TARGET,
        externalModules: [...sharpLayer.packagedDependencies, LAMBDA_ESBUILD_EXTERNAL_AWS_SDK]
      }
    });

    staticAssetsBucket.grantRead(imageLambda);

    const api = new apigw.HttpApi(this, 'NextJsApiGateway');

    const serverLambdaIntegration = new apigwInt.HttpLambdaIntegration('NextJsServerLambdaIntegration', serverLambda);
    const imageLambdaIntegration = new apigwInt.HttpLambdaIntegration('NextJsImageLambdaIntegration', imageLambda);

    api.addRoutes({
      path: `${SERVER_ENDPOINT}/{proxy+}`,
      methods: [apigw.HttpMethod.GET],
      integration: serverLambdaIntegration
    });

    api.addRoutes({
      path: SERVER_ENDPOINT,
      methods: [apigw.HttpMethod.GET],
      integration: serverLambdaIntegration
    });

    api.addRoutes({
      path: `${IMAGE_ENDPOINT}/{proxy+}`,
      methods: [apigw.HttpMethod.GET],
      integration: imageLambdaIntegration
    });

    api.addRoutes({
      path: IMAGE_ENDPOINT,
      methods: [apigw.HttpMethod.GET],
      integration: imageLambdaIntegration
    });

    return api;
  }

  private createStaticAssetsBucket(bucketName?: string) {
    const distPath = path.resolve(this.stackProps.nextJsPath, '.next');
    const staticPath = path.resolve(distPath, 'static');
    const publicPath = path.resolve(this.stackProps.nextJsPath, 'public');

    const staticAssetsBucket = new s3.Bucket(this, `NextJsStaticAssets`, {
      bucketName: bucketName,
      autoDeleteObjects: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    new s3d.BucketDeployment(this, 'NextJsStaticAssetsDeployment', {
      destinationBucket: staticAssetsBucket,
      destinationKeyPrefix: '_next/static',
      sources: [s3d.Source.asset(staticPath)],
      prune: false,
      cacheControl: [s3d.CacheControl.fromString('public, max-age=315360000, immutable')]
    });

    new s3d.BucketDeployment(this, 'NextJsPublicAssetsDeployment', {
      destinationBucket: staticAssetsBucket,
      sources: [s3d.Source.asset(publicPath)],
      prune: false
    });

    return staticAssetsBucket;
  }

  private createCloudFrontDistribution(staticAssetsBucket: s3.Bucket, api: apigw.HttpApi) {
    const staticOrigin = new cfo.S3Origin(staticAssetsBucket);
    const apiDomain = `${api.apiId}.execute-api.${Stack.of(this).region}.amazonaws.com`;

    const nextServerOrigin = new cfo.HttpOrigin(`${apiDomain}`, {
      protocolPolicy: cf.OriginProtocolPolicy.HTTPS_ONLY,
      originPath: SERVER_ENDPOINT
    });

    const nextImageOrigin = new cfo.HttpOrigin(`${apiDomain}`, {
      protocolPolicy: cf.OriginProtocolPolicy.HTTPS_ONLY,
      originPath: IMAGE_ENDPOINT
    });

    const certificate =
      this.stackProps.domain &&
      cm.Certificate.fromCertificateArn(this, 'NextJsCertificate', this.stackProps.domain.domainCertificateArn);

    const domainNames = this.stackProps.domain
      ? [this.stackProps.domain.name, ...(this.stackProps.domain.aliases || [])]
      : undefined;

    const nextServerCachePolicy = new cf.CachePolicy(this, 'NextServerCachePolicy', {
      comment: 'NextJS 14 Server optimized',
      queryStringBehavior: cf.CacheQueryStringBehavior.none(),
      cookieBehavior: cf.CacheCookieBehavior.none(),
      headerBehavior: cf.CacheHeaderBehavior.allowList(
        'RSC',
        'Next-Router-Prefetch',
        'Next-Router-State-Tree',
        'Next-Url',
        ...(this.stackProps.allowedCacheHeaders || [])
      ),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
      defaultTtl: cdk.Duration.days(365)
    });

    const nextImageCachePolicy = new cf.CachePolicy(this, 'NextImageCachePolicy', {
      comment: 'NextJS 14 image optimized',
      queryStringBehavior: cf.CacheQueryStringBehavior.all(),
      enableAcceptEncodingGzip: true,
      defaultTtl: cdk.Duration.days(30)
    });

    const additionalBehaviors: Record<string, cf.BehaviorOptions> = {
      '/_next/static/*': {
        origin: staticOrigin,
        cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED,
        viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS
      },
      '/_next/image': {
        origin: nextImageOrigin,
        cachePolicy: nextImageCachePolicy,
        compress: true
      },
      '/favicon.ico': {
        origin: staticOrigin,
        cachePolicy: cf.CachePolicy.CACHING_DISABLED,
        viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS
      },
      '/logo192.png': {
        origin: staticOrigin,
        cachePolicy: cf.CachePolicy.CACHING_DISABLED,
        viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS
      },
      '/manifest.json': {
        origin: staticOrigin,
        cachePolicy: cf.CachePolicy.CACHING_DISABLED,
        viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS
      },
      '/robot.txt': {
        origin: staticOrigin,
        cachePolicy: cf.CachePolicy.CACHING_DISABLED,
        viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS
      }
    };

    this.stackProps.additionalCachingPaths?.forEach(path => {
      additionalBehaviors[path] = {
        origin: staticOrigin,
        cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED,
        viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS
      };
    });

    const cloudfrontDistribution = new cf.Distribution(this, 'NextJsCloudfrontDistribution', {
      domainNames,
      certificate,
      priceClass: cf.PriceClass.PRICE_CLASS_100,
      httpVersion: cf.HttpVersion.HTTP2,
      minimumProtocolVersion: cf.SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultBehavior: {
        origin: nextServerOrigin,
        viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: nextServerCachePolicy
      },
      additionalBehaviors
    });

    new s3d.BucketDeployment(this, 'NextJsInvalidationDeployment', {
      destinationBucket: staticAssetsBucket,
      destinationKeyPrefix: '/',
      sources: [s3d.Source.data('BUILD_ID', this.buildId)],
      prune: false,
      distribution: cloudfrontDistribution,
      distributionPaths: ['/*']
    });

    this.stackProps.domain &&
      new r53.ARecord(this, `${this.stackProps.domain.name}_Alias}`, {
        recordName: this.stackProps.domain.name,
        target: r53.RecordTarget.fromAlias(new r53t.CloudFrontTarget(cloudfrontDistribution)),
        zone: this.stackProps.domain.hostedZone
      });

    return cloudfrontDistribution;
  }
}
