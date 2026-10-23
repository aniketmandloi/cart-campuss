import type { Context as ApiContext } from "@cart-campuss/api/context";
import { readPresentedOperatorToken } from "@cart-campuss/api/publishing";
import type { Database } from "@cart-campuss/db";
import type { Context as HonoContext } from "hono";

export type CreateContextOptions = {
  context: HonoContext;
  db: Database;
  operatorToken: string | null;
};

export async function createContext(options: CreateContextOptions): Promise<ApiContext> {
  return {
    db: options.db,
    operatorToken: options.operatorToken,
    presentedOperatorToken: readPresentedOperatorToken(options.context.req.header("authorization")),
  };
}
