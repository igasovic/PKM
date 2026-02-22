import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const target = env.VITE_PKM_ORIGIN || 'http://192.168.5.4:3010';
    const adminSecret = env.PKM_ADMIN_SECRET || '';
    return {
        plugins: [react()],
        server: {
            host: '0.0.0.0',
            port: 5173,
            proxy: {
                '/debug': {
                    target,
                    changeOrigin: true,
                    headers: adminSecret
                        ? { 'x-pkm-admin-secret': adminSecret }
                        : undefined,
                },
            },
        },
    };
});
