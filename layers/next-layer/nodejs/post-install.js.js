const fs = require('fs');

fs.rmSync('node_modules/@next', { recursive: true, force: true });
fs.rmSync('node_modules/@swc', { recursive: true, force: true });
