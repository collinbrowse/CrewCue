import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import type { FastifyRequest } from "fastify";
import type { IdentityClaims } from "@crewcue/contracts";
import { isAuth0Configured, verifyAuth0AccessToken } from "../lib/auth0Jwt.js";
import { mapJwtPayloadToIdentity } from "../lib/authIdentity.js";

declare module "fastify" {
  interface FastifyRequest {
    identity?: IdentityClaims;
  }
}

function readBearer(request: FastifyRequest): string | undefined {
  const raw = request.headers.authorization;
  if (!raw || typeof raw !== "string") {
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : undefined;
}

export const authPlugin = fp(async (app) => {
  await app.register(fastifyJwt, {
    secret: process.env.JWT_SECRET ?? "dev-only-secret",
  });

  app.decorateRequest("identity", undefined);

  app.addHook("preHandler", async (request) => {
    if (request.url.startsWith("/health")) {
      return;
    }

    if (isAuth0Configured()) {
      const bearer = readBearer(request);
      if (!bearer) {
        request.identity = undefined;
        return;
      }
      try {
        const payload = await verifyAuth0AccessToken(bearer);
        request.identity = mapJwtPayloadToIdentity(payload, {
          claimNamespace: process.env.AUTH0_CLAIM_NAMESPACE?.trim(),
        });
      } catch (err) {
        request.log.debug({ err }, "auth0_jwt_verify_failed");
        request.identity = undefined;
      }
      return;
    }

    try {
      await request.jwtVerify();
      const decoded = request.user as Record<string, unknown> | undefined;
      request.identity = decoded ? mapJwtPayloadToIdentity(decoded) : undefined;
    } catch {
      request.identity = undefined;
    }
  });
});
