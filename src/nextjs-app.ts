import { NpmLayerVersion } from "@apimda/deploy-cdk";

import { Stack } from "aws-cdk-lib";
import { Construct } from "constructs";
import fs from "fs";
import * as path from "path";

import * as cdk from "aws-cdk-lib";
import * as cf from "aws-cdk-lib/aws-cloudfront";
import * as cfo from "aws-cdk-lib/aws-cloudfront-origins";
import * as cm from "aws-cdk-lib/aws-certificatemanager";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as r53 from "aws-cdk-lib/aws-route53";
import * as r53t from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3d from "aws-cdk-lib/aws-s3-deployment";
import * as apigw from "@aws-cdk/aws-apigatewayv2-alpha";
import * as apigwInt from "@aws-cdk/aws-apigatewayv2-integrations-alpha";

import {
  LAMBDA_ESBUILD_EXTERNAL_AWS_SDK,
  LAMBDA_ESBUILD_TARGET,
  LAMBDA_RUNTIME,
} from "./stack-utils";

const SERVER_ENDPOINT = "/server";
const IMAGE_ENDPOINT = "/image";

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
  domain: NextJsAppDomain;

  /**
   * Name of the underlying bucket which stores the
   * NextJS build. If @see domain is defined, the name
   * of the bucket will be set to @see domain.name
   * which is required by S3
   * @see https://docs.aws.amazon.com/AmazonS3/latest/userguide/website-hosting-custom-domain-walkthrough.html#root-domain-walkthrough-create-buckets
   */
  bucketName?: string;

  /**
   * Npm Layer which hold all next deps
   */
  nextLayerVersion: NpmLayerVersion;

  /**
   * Npm Layer which holds sharp deps.
   */
  sharpLayerVersion: NpmLayerVersion;

  /**
   *
   */
  readonly nextServerEnvironment?: Record<string, string>;
}

export class NextJsApp extends Construct {
  private readonly stackProps: NextJsAppProps;
  private readonly buildId: string;
  public readonly appUrl: string;

  constructor(scope: Construct, id: string, stackProps: NextJsAppProps) {
    super(scope, id);

    if (!fs.existsSync(stackProps.nextJsPath)) {
      throw new Error("Next build folder not found. Did you forgot to build ?");
    }

    this.buildId = fs
      .readFileSync(path.resolve(stackProps.nextJsPath, ".next/BUILD_ID"))
      .toString("utf-8");

    stackProps.bucketName =
      (stackProps.domain && stackProps.domain.name) || stackProps.bucketName;
    this.stackProps = stackProps;

    const staticAssetsBucket = this.createStaticAssetsBucket();
    const api = this.createNextServer(staticAssetsBucket);
    this.createCloudFrontDistribution(staticAssetsBucket, api);

    this.appUrl =
      (this.stackProps.domain && `https://${this.stackProps.domain.name}`) ||
      staticAssetsBucket.bucketWebsiteUrl;
  }

  private createNextServer(staticAssetsBucket: s3.Bucket) {
    const serverLayerVersion = new lambda.LayerVersion(
      this,
      "NextJsDeploymentLayer",
      {
        code: lambda.Code.fromAsset(this.stackProps.nextJsPath, {
          ignoreMode: cdk.IgnoreMode.GIT,
          exclude: [
            ".next/cache",
            ".next/static",
            "/app",
            "components",
            "scripts",
            ".storybook",
            ".vscode",
            "public",
            "/*.js",
            "/*.json",
          ],
        }),
      }
    );

    const serverLambda = new lambdaNode.NodejsFunction(
      this,
      "NextJsServerLambda",
      {
        runtime: LAMBDA_RUNTIME,
        timeout: cdk.Duration.seconds(29),
        layers: [
          serverLayerVersion,
          this.stackProps.nextLayerVersion.layerVersion,
        ],
        memorySize: 512,
        entry: path.resolve(__dirname, "next-server-handler.js"),
        environment: this.stackProps.nextServerEnvironment,
        bundling: {
          minify: false,
          target: LAMBDA_ESBUILD_TARGET,
          externalModules: [
            LAMBDA_ESBUILD_EXTERNAL_AWS_SDK,
            ...this.stackProps.nextLayerVersion.packagedDependencies,
            "/opt/.next/*",
          ],
        },
      }
    );

    const imageLambda = new lambdaNode.NodejsFunction(
      this,
      "NextJsImageLambda",
      {
        runtime: LAMBDA_RUNTIME,
        timeout: cdk.Duration.seconds(29),
        layers: [
          serverLayerVersion,
          this.stackProps.nextLayerVersion.layerVersion,
          this.stackProps.sharpLayerVersion.layerVersion,
        ],
        environment: {
          NEXT_BUILD_BUCKET: staticAssetsBucket.bucketName,
          NEXT_BUILD_ID: this.buildId,
        },
        memorySize: 512,
        entry: path.resolve(__dirname, "next-image-handler.js"),
        bundling: {
          minify: false,
          target: LAMBDA_ESBUILD_TARGET,
          externalModules: [
            LAMBDA_ESBUILD_EXTERNAL_AWS_SDK,
            "/opt/.next/required-server-files.json",
          ],
        },
      }
    );

    staticAssetsBucket.grantRead(imageLambda);

    const api = new apigw.HttpApi(this, "NextJsApiGateway");

    const serverLambdaIntegration = new apigwInt.HttpLambdaIntegration(
      "NextJsServerLambdaIntegration",
      serverLambda
    );
    const imageLambdaIntegration = new apigwInt.HttpLambdaIntegration(
      "NextJsImageLambdaIntegration",
      imageLambda
    );

    api.addRoutes({
      path: `${SERVER_ENDPOINT}/{proxy+}`,
      methods: [apigw.HttpMethod.GET],
      integration: serverLambdaIntegration,
    });

    api.addRoutes({
      path: `${IMAGE_ENDPOINT}/{proxy+}`,
      methods: [apigw.HttpMethod.GET],
      integration: imageLambdaIntegration,
    });

    api.addRoutes({
      path: SERVER_ENDPOINT,
      methods: [apigw.HttpMethod.GET],
      integration: serverLambdaIntegration,
    });

    api.addRoutes({
      path: IMAGE_ENDPOINT,
      methods: [apigw.HttpMethod.GET],
      integration: imageLambdaIntegration,
    });

    return api;
  }

  private createStaticAssetsBucket() {
    const distPath = path.resolve(this.stackProps.nextJsPath, ".next");
    const staticPath = path.resolve(distPath, "static");
    const publicPath = path.resolve(this.stackProps.nextJsPath, "public");

    const staticAssetsBucket = new s3.Bucket(this, `NextJsStaticAssets`, {
      bucketName: this.stackProps.bucketName,
      encryption: s3.BucketEncryption.UNENCRYPTED,
      websiteIndexDocument: "index.html",
      websiteErrorDocument: "404.html",
      publicReadAccess: true,
      autoDeleteObjects: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new s3d.BucketDeployment(this, "NextJsStaticAssetsDeployment", {
      destinationBucket: staticAssetsBucket,
      destinationKeyPrefix: "_next/static",
      sources: [s3d.Source.asset(staticPath)],
      prune: false,
    });

    new s3d.BucketDeployment(this, "NextJsPublicAssetsDeployment", {
      destinationBucket: staticAssetsBucket,
      sources: [s3d.Source.asset(publicPath)],
      prune: false,
    });

    return staticAssetsBucket;
  }

  private createCloudFrontDistribution(
    staticAssetsBucket: s3.Bucket,
    api: apigw.HttpApi
  ) {
    const staticOrigin = new cfo.HttpOrigin(
      staticAssetsBucket.bucketWebsiteDomainName,
      {
        protocolPolicy: cf.OriginProtocolPolicy.HTTP_ONLY,
      }
    );

    const apiDomain = `${api.apiId}.execute-api.${
      Stack.of(this).region
    }.amazonaws.com`;

    const nextServerOrigin = new cfo.HttpOrigin(`${apiDomain}`, {
      protocolPolicy: cf.OriginProtocolPolicy.HTTPS_ONLY,
      originPath: SERVER_ENDPOINT,
    });

    const nextImageOrigin = new cfo.HttpOrigin(`${apiDomain}`, {
      protocolPolicy: cf.OriginProtocolPolicy.HTTPS_ONLY,
      originPath: IMAGE_ENDPOINT,
    });

    const certificate =
      this.stackProps.domain &&
      cm.Certificate.fromCertificateArn(
        this,
        "NextJsCertificate",
        this.stackProps.domain.domainCertificateArn
      );

    const domainNames = this.stackProps.domain
      ? [this.stackProps.domain.name, ...(this.stackProps.domain.aliases || [])]
      : undefined;

    const nextServerCachePolicy = new cf.CachePolicy(
      this,
      "NextServerCachePolicy",
      {
        comment: "NextJS 13 Server optimized",
        queryStringBehavior: cf.CacheQueryStringBehavior.none(),
        cookieBehavior: cf.CacheCookieBehavior.none(),
        headerBehavior: cf.CacheHeaderBehavior.allowList(
          "RSC",
          "accept",
          "accept-language",
          "content-language",
          "content-type",
          "user-agent",
          "authorization"
        ),
        enableAcceptEncodingGzip: true,
        enableAcceptEncodingBrotli: true,
      }
    );

    const nextImageCachePolicy = new cf.CachePolicy(
      this,
      "NextImageCachePolicy",
      {
        comment: "NextJS 13 image optimized",
        queryStringBehavior: cf.CacheQueryStringBehavior.all(),
        enableAcceptEncodingGzip: true,
        defaultTtl: cdk.Duration.days(30),
      }
    );

    const cloudfrontDistribution = new cf.Distribution(
      this,
      "NextJsCloudfrontDistribution",
      {
        domainNames,
        certificate,
        priceClass: cf.PriceClass.PRICE_CLASS_100,
        httpVersion: cf.HttpVersion.HTTP2,
        minimumProtocolVersion: cf.SecurityPolicyProtocol.TLS_V1_2_2021,
        defaultBehavior: {
          origin: nextServerOrigin,
          viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: nextServerCachePolicy,
        },
        additionalBehaviors: {
          "/_next/static/*": {
            origin: staticOrigin,
            cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED,
            viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          },
          "/_next/image": {
            origin: nextImageOrigin,
            cachePolicy: nextImageCachePolicy,
            compress: true,
          },
          "/favicon.ico": {
            origin: staticOrigin,
            cachePolicy: cf.CachePolicy.CACHING_DISABLED,
            viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          },
          "/logo192.png": {
            origin: staticOrigin,
            cachePolicy: cf.CachePolicy.CACHING_DISABLED,
            viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          },
          "/manifest.json": {
            origin: staticOrigin,
            cachePolicy: cf.CachePolicy.CACHING_DISABLED,
            viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          },
          "/robot.txt": {
            origin: staticOrigin,
            cachePolicy: cf.CachePolicy.CACHING_DISABLED,
            viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          },
        },
      }
    );

    new s3d.BucketDeployment(this, "NextJsInvalidationDeployment", {
      destinationBucket: staticAssetsBucket,
      destinationKeyPrefix: "/",
      sources: [s3d.Source.data("BUILD_ID", this.buildId)],
      prune: false,
      /**
       * TODO: Fine tune caching and rethink about cache CloudFront invalidation
       * @see https://github.com/GetYourSportsDE/gys-next/issues/128
       *
       * distribution: cloudfrontDistribution,
       * distributionPaths: ['/*'],
       */
    });

    this.stackProps.domain &&
      new r53.ARecord(this, `${this.stackProps.domain.name}_Alias}`, {
        recordName: this.stackProps.domain.name,
        target: r53.RecordTarget.fromAlias(
          new r53t.CloudFrontTarget(cloudfrontDistribution)
        ),
        zone: this.stackProps.domain.hostedZone,
      });

    return cloudfrontDistribution;
  }
}
