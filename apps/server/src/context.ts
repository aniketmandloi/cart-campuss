import type { Context as ApiContext } from "@cart-campuss/api/context";
import type { Context as HonoContext } from "hono";

import { ENV } from "./env.server";
import { db } from "./services";

export type CreateContextOptions = {
  context: HonoContext;
};

export async function createContext(_options: CreateContextOptions): Promise<ApiContext> {
  return {
    db,
    access: { allowFixtures: ENV.CATALOGUE_ALLOW_FIXTURES === true },
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
