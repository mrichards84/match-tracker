module "artifactregistry" {
  source  = "artifact-registry.local:8080/local/artifacts/google"
  version = "1.0.2"

  project_id   = var.project_id
  region       = var.region
  repo_name    = "match-tracker-repo"
  description  = "Docker repository for Match Tracker"
  labels       = var.labels
}
