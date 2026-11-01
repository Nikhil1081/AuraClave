import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

function apiDevServerPlugin(): Plugin {
  return {
    name: "api-dev-server",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();

        const endpoint = req.url.split("?")[0];
        let handlerModule: any;
        if (endpoint === "/api/token") {
          handlerModule = await server.ssrLoadModule("./api/token.ts");
        } else if (endpoint === "/api/ai") {
          handlerModule = await server.ssrLoadModule("./api/ai.ts");
        } else {
          return next();
        }

        let body: any = {};
        if (req.method === "POST") {
          const buffers: Buffer[] = [];
          for await (const chunk of req) {
            buffers.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const raw = Buffer.concat(buffers).toString("utf-8");
          if (raw) {
            try {
              body = JSON.parse(raw);
            } catch {
              body = {};
            }
          }
        }
        (req as any).body = body;

        const resShim = res as any;
        resShim.status = (code: number) => {
          res.statusCode = code;
          return resShim;
        };
        resShim.json = (data: any) => {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(data));
          return resShim;
        };

        try {
          await handlerModule.default(req, resShim);
        } catch (err: any) {
          console.error("API error:", err);
          if (!res.writableEnded) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: err?.message || "Internal server error" }));
          }
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  Object.assign(process.env, env);

  return {
    plugins: [react(), tailwindcss(), apiDevServerPlugin()],
  };
});
