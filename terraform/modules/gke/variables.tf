variable "name" {
  description = "Prefix for the resources this module creates."
  type        = string
}

variable "project" {
  type = string
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
}

variable "labels" {
  type    = map(string)
  default = {}
}
