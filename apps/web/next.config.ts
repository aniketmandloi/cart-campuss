import { PUBLIC_CACHE_CONTROL } from "@cart-campuss/api/public-cache";
import { varlockNextConfigPlugin } from "@varlock/nextjs-integration/plugin";

const withVarlock = varlockNextConfigPlugin();
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  reactCompiler: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Cache-Control", value: PUBLIC_CACHE_CONTROL }],
      },
    ];
  },
};

export default withVarlock(nextConfig);
