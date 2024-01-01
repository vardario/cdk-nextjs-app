import * as lambda from 'aws-cdk-lib/aws-lambda';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

export const LAMBDA_RUNTIME = lambda.Runtime.NODEJS_18_X;
export const LAMBDA_ARCHITECTURE = lambda.Architecture.ARM_64;
export const LAMBDA_ESBUILD_TARGET = 'node18';
export const LAMBDA_ESBUILD_EXTERNAL_AWS_SDK = '@aws-sdk/*';
export const DEFAULT_LAMBDA_CODE_EXCLUDES = ['controller/*', 'dao/*', '**/*.ts', '**/*.test.js'];

export function hash(filePath: string, algorithm: string = 'md5'): string {
  if (!fs.existsSync(filePath) || !fs.lstatSync(filePath).isFile()) {
    throw new Error(`File does not exist: ${filePath}`);
  }
  return crypto.createHash(algorithm).update(fs.readFileSync(filePath)).digest('hex');
}

function findInDir(dir: string, exclude: string[] = []) {
  const fileList: string[] = [];

  const _findInDir = (dir: string) => {
    const files = fs.readdirSync(dir);
    files.forEach(file => {
      const filePath = path.resolve(dir, file);
      const fileStat = fs.lstatSync(filePath);

      if (fileStat.isDirectory() || fileStat.isSymbolicLink()) {
        const nextDir = filePath.split(path.sep).pop()!;
        if (exclude.includes(nextDir)) {
          return;
        }
        _findInDir(filePath);
      } else {
        fileList.push(filePath);
      }
    });
  };

  _findInDir(dir);

  return fileList;
}

export function hashFolder(
  path: string,
  algorithm: string = 'md5',
  exclude: string[] = ['node_modules', '.next', '.vscode']
) {
  const files = findInDir(path, exclude);
  const hash = crypto.createHash(algorithm);

  files.forEach(file => {
    hash.update(fs.readFileSync(file));
  });

  return hash.digest('hex');
}
