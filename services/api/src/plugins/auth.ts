import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import { z } from "zod";
import type { FastifyRequest } from "fastify";
import type { IdentityClaims } from "@crewcue/contracts";

const claimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email().optional(),
  teamIds: z.array(z.string()),
  roomRoles: z.record(z.string(), z.string())
});

declare module "fastify" {
  interface FastifyRequest {
    identity?: IdentityClaims;
  }
}

function mapClaims(request: FastifyRequest): IdentityClaims | undefined {
  const decoded = request.user as Record<string, unknown> | undefined;
  if (!decoded) {
    return undefined;
  }

  const parsed = claimsSchema.safeParse(decoded);
  if (!parsed.success) {
    return undefined;
  }

  return parsed.data as IdentityClaims;
}

export const authPlugin = fp(async (app) => {
  await app.register(fastifyJwt, {
    secret: process.env.JWT_SECRET ?? "dev-only-secret"
  });

  app.decorateRequest("identity", undefined);

  app.addHook("preHandler", async (request) => {
    if (request.url.startsWith("/health")) {
      return;
    }
    try {
      await request.jwtVerify();
      request.identity = mapClaims(request);
    } catch {
      request.identity = undefined;
    }
  });
});
