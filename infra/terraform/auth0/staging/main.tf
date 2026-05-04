terraform {
  required_version = ">= 1.6.0"
  required_providers {
    auth0 = {
      source  = "auth0/auth0"
      version = "~> 1.9"
    }
  }
}

provider "auth0" {
  domain        = var.auth0_domain
  client_id     = var.auth0_management_client_id
  client_secret = var.auth0_management_client_secret
}

resource "auth0_resource_server" "crewcue_api" {
  name       = "CrewCue API (staging)"
  identifier = var.api_audience
  signing_alg = "RS256"
}

resource "auth0_client" "crewcue_mobile" {
  name            = "CrewCue Mobile (staging)"
  app_type        = "native"
  oidc_conformant = true

  refresh_token {
    rotation_type                = "rotating"
    expiration_type              = "expiring"
    token_lifetime               = 2_592_000
    infinite_token_lifetime      = false
    infinite_idle_token_lifetime = false
    idle_token_lifetime          = 1_296_000
  }

  callbacks = [
    "crewcue://auth"
  ]
}

resource "auth0_client_grant" "crewcue_mobile_api" {
  client_id = auth0_client.crewcue_mobile.id
  audience  = auth0_resource_server.crewcue_api.identifier
  scopes = [
    "openid",
    "profile",
    "email",
    "offline_access"
  ]
}
