import * as lambda from "aws-cdk-lib/aws-lambda";

export const LAMBDA_RUNTIME = lambda.Runtime.NODEJS_18_X;
export const LAMBDA_ARCHITECTURE = lambda.Architecture.ARM_64;
export const LAMBDA_ESBUILD_TARGET = "node18";
export const LAMBDA_ESBUILD_EXTERNAL_AWS_SDK = "@aws-sdk/*";
export const DEFAULT_LAMBDA_CODE_EXCLUDES = [
  "controller/*",
  "dao/*",
  "**/*.ts",
  "**/*.test.js",
];
