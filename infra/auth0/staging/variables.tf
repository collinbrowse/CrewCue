variable "auth0_domain" {
  description = "Auth0 tenant domain (example: your-tenant.us.auth0.com)"
  type        = string
}

variable "auth0_management_client_id" {
  description = "Machine-to-machine Auth0 Management API client id"
  type        = string
}

variable "auth0_management_client_secret" {
  description = "Machine-to-machine Auth0 Management API client secret"
  type        = string
  sensitive   = true
}

variable "api_audience" {
  description = "CrewCue API audience identifier for Auth0 access tokens"
  type        = string
  default     = "https://crewcue-staging-api"
}
