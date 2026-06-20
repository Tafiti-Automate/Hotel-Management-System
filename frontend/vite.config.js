import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var env = loadEnv(mode, '.', '');
    var backendTarget = env.VITE_BACKEND_URL || 'http://127.0.0.1:8000';
    return {
        plugins: [react()],
        // `vite preview` (used by the Railway deployment) blocks unknown Host headers
        // by default. Allow the deployed domain so the public URL isn't rejected.
        preview: {
            host: true,
            allowedHosts: true,
        },
        server: {
            port: 5173,
            open: true,
            watch: {
                ignored: [
                    '**/hotel_erp_backend/.venv/**',
                    '**/hotel_erp_backend/**/__pycache__/**',
                    '**/hotel_erp_backend/db.sqlite3',
                    '**/hotel_erp_backend/staticfiles/**',
                    '**/.pytest_cache/**',
                ],
            },
            proxy: {
                '/api': {
                    target: backendTarget,
                    changeOrigin: true,
                },
            },
        },
    };
});
