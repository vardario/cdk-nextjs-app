const fs = require('fs');

function modifyInitializeRequireHook(isAppDirEnabled) {
  const initialRequireHookFilePath = require.resolve('next/dist/server/initialize-require-hook');
  const content = fs.readFileSync(initialRequireHookFilePath, 'utf8');

  fs.writeFileSync(
    initialRequireHookFilePath,
    content.replace(/isPrebundled = (true|false)/, `isPrebundled = ${isAppDirEnabled}`)
  );
}

fs.rmSync('./node_modules/@next/swc-darwin-arm64', { recursive: true, force: true });
fs.rmSync('./node_modules/@next/swc-linux-x64-gnu', { recursive: true, force: true });
fs.rmSync('./node_modules/@next/swc-linux-x64-musl', { recursive: true, force: true });

modifyInitializeRequireHook(true);
