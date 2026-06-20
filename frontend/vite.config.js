import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var env = loadEnv(mode, '.', '');
    // BACKEND_ORIGIN (runtime, read when the preview server boots) points the
    // deployed proxy at the Django service; falls back to the dev backend.
    var backendTarget = env.BACKEND_ORIGIN || env.VITE_BACKEND_URL || 'http://127.0.0.1:8000';
    return {
        plugins: [react()],
        // `vite preview` (used by the Railway deployment) blocks unknown Host headers
        // by default. Allow the deployed domain, and proxy /api to the backend so the
        // browser stays same-origin (no CORS needed).
        preview: {
            host: true,
            allowedHosts: true,
            proxy: {
                '/api': {
                    target: backendTarget,
                    changeOrigin: true,
                    secure: true,
                },
            },
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
