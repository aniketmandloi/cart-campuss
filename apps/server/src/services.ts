import { createDb } from "@cart-campuss/db";

import { ENV } from "./env.server";

export const db = createDb(ENV);
