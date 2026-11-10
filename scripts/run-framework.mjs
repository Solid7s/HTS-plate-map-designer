import { fileURLToPath } from 'node:url';
const [command, ...args] = process.argv.slice(2);
if (!['dev', 'build', 'start'].includes(command)) throw new Error('Expected dev, build, or start.');
const cli = new URL('../node_modules/vinext/dist/cli.js', import.meta.url);
process.argv = [process.execPath, fileURLToPath(cli), command,
  ...(command === 'dev' ? ['--port', '5173'] : []),
  ...args,
  ...(command !== 'build' ? ['--hostname', '127.0.0.1'] : []),
];
await import(cli.href);
