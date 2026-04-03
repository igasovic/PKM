import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_PKM_ORIGIN || 'http://192.168.5.4:3010';
  const adminSecret = env.PKM_ADMIN_SECRET || '';
  const readProxyPlugin = {
    name: 'pkm-internal-api-proxy',
    configureServer(server: any) {
      // Startup signal so we can verify this plugin is loaded by the active Vite process.
      // eslint-disable-next-line no-console
      console.log(`[pkm-internal-api-proxy] enabled -> ${target}`);
      server.middlewares.use(async (req: any, res: any, next: any) => {
        const path = String(req.url || '');
        if (!path.startsWith('/db/') && !path.startsWith('/recipes/')) return next();
        // eslint-disable-next-line no-console
        console.log(`[pkm-internal-api-proxy] ${String(req.method || 'GET').toUpperCase()} ${path}`);

        try {
          const method = String(req.method || 'GET').toUpperCase();
          const upstreamUrl = new URL(path, target).toString();

          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers || {})) {
            if (!value) continue;
            const name = String(key).toLowerCase();
            if (name === 'host' || name === 'content-length' || name === 'connection') continue;
            if (Array.isArray(value)) {
              value.forEach((v) => headers.append(String(key), String(v)));
            } else {
              headers.set(String(key), String(value));
            }
          }

          let body: Buffer | undefined;
          if (method !== 'GET' && method !== 'HEAD') {
            const chunks: Buffer[] = [];
            await new Promise<void>((resolve, reject) => {
              req.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
              req.on('end', () => resolve());
              req.on('error', reject);
            });
            body = Buffer.concat(chunks);
          }

          const upstream = await fetch(upstreamUrl, {
            method,
            headers,
            body,
          });

          res.statusCode = upstream.status;
          upstream.headers.forEach((value, key) => {
            if (key.toLowerCase() === 'transfer-encoding') return;
            res.setHeader(key, value);
          });

          const data = Buffer.from(await upstream.arrayBuffer());
          res.end(data);
        } catch (err: any) {
          res.statusCode = 502;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'proxy_error', message: String(err?.message || err) }));
        }
      });
    },
  };

  return {
    plugins: [react(), readProxyPlugin],
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, '../../libs'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      fs: {
        allow: [path.resolve(__dirname, '../../')],
      },
      proxy: {
        '^/api/debug(/|$)': {
          target,
          changeOrigin: true,
          rewrite: (proxyPath) => proxyPath.replace(/^\/api/, ''),
          headers: adminSecret
            ? { 'x-pkm-admin-secret': adminSecret }
            : undefined,
        },
      },
    },
  };
});
