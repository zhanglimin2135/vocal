import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths";
import { traeBadgePlugin } from 'vite-plugin-trae-solo-badge';
import hanyuHandler from "./api/hanyu";
import booksHandler from "./api/books";

/** 本地开发时把 /api/* 交给和 Vercel 相同的处理函数 */
function localApiPlugin(): Plugin {
  return {
    name: "local-api",
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), "");
      ["SUPABASE_URL", "SUPABASE_ANON_KEY", "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"].forEach((k) => {
        if (!process.env[k] && env[k]) process.env[k] = env[k];
      });
      server.middlewares.use("/api/hanyu", (req, res) => {
        void hanyuHandler(req as never, res as never);
      });
      server.middlewares.use("/api/books", (req, res) => {
        void booksHandler(req as never, res as never);
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  build: {
    sourcemap: 'hidden',
  },
  plugins: [
    react({
      babel: {
        plugins: [
          'react-dev-locator',
        ],
      },
    }),
    traeBadgePlugin({
      variant: 'dark',
      position: 'bottom-right',
      prodOnly: true,
      clickable: true,
      clickUrl: 'https://www.trae.ai/solo?showJoin=1',
      autoTheme: true,
      autoThemeTarget: '#root'
    }), 
    tsconfigPaths(),
    localApiPlugin()
  ],
})
