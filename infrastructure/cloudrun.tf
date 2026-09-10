# Cloud Run: Single Container App
module "cloudrun" {
  source  = "artifact-registry.local:8080/local/cloudrun/google"
  version = "1.7.0"

  single_container     = true
  project_id           = var.project_id
  region               = var.region
  service_name         = "match-tracker-app"
  labels               = var.labels
  repo_name            = "match-tracker-repo"
  image_name           = "web"
  image_tag            = var.image_tag
  container_port       = 3000
  deployment_timestamp = var.deployment_timestamp
}
