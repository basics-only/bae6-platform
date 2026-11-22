variable "name" {
  description = "Prefix for the resources this module creates."
  type        = string
}

variable "project" {
  type = string
}

variable "cluster_project" {
  description = "Project of the GKE cluster, whose Workload Identity pool the runtimes bind to. Defaults to project."
  type        = string
  default     = null
}

variable "region" {
  type = string
}

variable "network_id" {
  description = "VPC network (self link or id) with private services access already configured for Cloud SQL."
  type        = string
}

variable "database" {
  type = object({
    version             = optional(string, "POSTGRES_16")
    tier                = optional(string, "db-custom-2-7680")
    disk_size_gb        = optional(number, 20)
    availability_type   = optional(string, "ZONAL")
    deletion_protection = optional(bool, true)
  })
  default = {}
}

variable "runtimes" {
  description = "One Google service account per runtime, bound to its Kubernetes ServiceAccount through Workload Identity."
  type = map(object({
    namespace       = string
    service_account = optional(string)
    vertex          = optional(bool, false)
    database        = optional(bool, false)
    secret_names    = optional(list(string), [])
  }))
  default = {}

  validation {
    condition = alltrue(concat(
      [for k in keys(var.runtimes) : can(regex("^[a-z0-9]+(-[a-z0-9]+)*$", k))],
      [for r in values(var.runtimes) : alltrue([for s in r.secret_names : can(regex("^[a-z0-9]+(-[a-z0-9]+)*$", s))])],
    ))
    error_message = "Runtime keys and secret names are lowercase letters and digits joined by single hyphens, so derived ids cannot collide."
  }

  validation {
    condition     = alltrue([for r in values(var.runtimes) : length(r.secret_names) == length(toset(r.secret_names))])
    error_message = "A runtime's secret_names must not repeat."
  }
}

variable "labels" {
  type    = map(string)
  default = {}
}
