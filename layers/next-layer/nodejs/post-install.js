// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs');

[
  'node_modules/@next/swc-linux-x64-gnu',
  'node_modules/@next/swc-linux-x64-musl',
  'node_modules/@next/swc-darwin-arm64',
  'node_modules/@next/swc-darwin-x64',
  'node_modules/@next/swc-linux-arm64-gnu',
  'node_modules/@next/swc-linux-arm64-musl',
  'node_modules/@next/swc-linux-arm-gnueabihf'
].forEach(dir => {
  fs.rmSync(dir, { recursive: true, force: true });
});
