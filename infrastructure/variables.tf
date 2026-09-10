variable "project_id" {
  description = "The GCP project ID"
  type        = string
}

variable "region" {
  description = "The GCP region"
  type        = string
  default     = "europe-west2"
}

variable "image_tag" {
  description = "The tag to use for all container images"
  type        = string
  default     = "latest"
}

variable "labels" {
  description = "Labels to apply to all resources"
  type        = map(string)
  default     = {
    service     = "match-tracker"
    environment = "production"
  }
}

variable "deployment_timestamp" {
  description = "Timestamp to force redeployment"
  type        = string
  default     = ""
}