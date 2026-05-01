#!/usr/bin/env node

/**
 * Updates native callback/logout/web-origin settings for CrewCue mobile Auth0 app.
 * Requires:
 *   AUTH0_DOMAIN
 *   AUTH0_MGMT_CLIENT_ID
 *   AUTH0_MGMT_CLIENT_SECRET
 *   AUTH0_MOBILE_CLIENT_ID
 */

const {
  AUTH0_DOMAIN,
  AUTH0_MGMT_CLIENT_ID,
  AUTH0_MGMT_CLIENT_SECRET,
  AUTH0_MOBILE_CLIENT_ID
} = process.env;

for (const [key, value] of Object.entries({
  AUTH0_DOMAIN,
  AUTH0_MGMT_CLIENT_ID,
  AUTH0_MGMT_CLIENT_SECRET,
  AUTH0_MOBILE_CLIENT_ID
})) {
  if (!value) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

const tokenRes = await fetch(`https://${AUTH0_DOMAIN}/oauth/token`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    client_id: AUTH0_MGMT_CLIENT_ID,
    client_secret: AUTH0_MGMT_CLIENT_SECRET,
    audience: `https://${AUTH0_DOMAIN}/api/v2/`,
    grant_type: "client_credentials"
  })
});

if (!tokenRes.ok) {
  console.error("Failed to fetch Auth0 management token:", await tokenRes.text());
  process.exit(1);
}
const tokenPayload = await tokenRes.json();
const mgmtToken = tokenPayload.access_token;

const updateRes = await fetch(`https://${AUTH0_DOMAIN}/api/v2/clients/${AUTH0_MOBILE_CLIENT_ID}`, {
  method: "PATCH",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${mgmtToken}`
  },
  body: JSON.stringify({
    callbacks: ["crewcue://auth"],
    allowed_logout_urls: ["crewcue://auth"],
    web_origins: ["crewcue://auth"],
    app_type: "native",
    oidc_conformant: true
  })
});

if (!updateRes.ok) {
  console.error("Failed to update Auth0 mobile client:", await updateRes.text());
  process.exit(1);
}

console.log("Auth0 mobile client callback/logout/origin settings updated successfully.");
