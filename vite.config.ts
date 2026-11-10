import vinext from 'vinext';
import { defineConfig } from 'vite';
import { configureToolEnvironment } from './scripts/tool-environment.mjs';
import { sites } from './scripts/vite/sites-vite-plugin';

export default defineConfig(async () => {
  configureToolEnvironment(process.cwd());
  const { cloudflare } = await import('@cloudflare/vite-plugin');
  return {
    server: {
      host: '127.0.0.1',
      ...(process.env.CODEX_SANDBOX === 'seatbelt'
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      sites({ mockAuth: false }),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        inspectorPort: false,
        config: {
          main: './worker/index.ts',
          compatibility_flags: ['nodejs_compat'],
        },
      }),
    ],
  };
});
