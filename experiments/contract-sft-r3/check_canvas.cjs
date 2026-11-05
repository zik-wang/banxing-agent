// Optional local SDK typecheck; no model/network requests.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const [root, canvas, modules, sdk] = process.argv.slice(2);
if (!root || !canvas || !modules || !sdk) {
  throw new Error('usage: node check_canvas.cjs OUTPUT CANVAS ISOLATED_NODE_MODULES SDK_INDEX_DTS');
}
const config = {
  compilerOptions: {
    target: 'ES2021', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
    strict: true, noEmit: true, skipLibCheck: true, allowSyntheticDefaultImports: true,
    types: ['react'], typeRoots: [path.join(modules, '@types')],
    paths: {
      'cursor/canvas': [sdk],
      react: [path.join(modules, '@types/react/index.d.ts')],
      'react/*': [path.join(modules, '@types/react/*')],
    },
  },
  files: [canvas],
};
const configFile = path.join(root, 'canvas-typecheck-tsconfig.json');
fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
const result = cp.spawnSync(process.execPath,
  [path.join(modules, 'typescript/bin/tsc'), '--project', configFile, '--pretty', 'false'],
  { encoding: 'utf8', timeout: 60000, windowsHide: true });
const receipt = {
  at: new Date().toISOString(), canvas,
  typescript: JSON.parse(fs.readFileSync(path.join(modules, 'typescript/package.json'))).version,
  passed: result.status === 0, status: result.status, stdout: result.stdout,
  stderr: result.stderr, error: result.error?.message,
  limitation: 'TypeScript check only; not independent host-render or business acceptance',
};
fs.writeFileSync(path.join(root, 'canvas-typecheck.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt));
if (result.status !== 0) process.exitCode = 1;
