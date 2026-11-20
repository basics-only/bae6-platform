variable "name" {
  description = "Prefix for the resources this module creates."
  type        = string
}

variable "cluster_name" {
  description = "Existing EKS cluster with the eks-pod-identity-agent add-on installed."
  type        = string
}

variable "vpc_id" {
  type = string
}

variable "database_subnet_ids" {
  description = "Private subnets for the database, in at least two availability zones."
  type        = list(string)

  validation {
    condition     = length(var.database_subnet_ids) >= 2
    error_message = "The database needs subnets in at least two availability zones."
  }
}

variable "database_client_security_group_ids" {
  description = "Security groups (for example the node group's) allowed to reach the database on 5432."
  type        = list(string)

  validation {
    condition     = length(var.database_client_security_group_ids) > 0
    error_message = "Name at least one client security group; the database is otherwise unreachable."
  }
}

variable "repositories" {
  description = "One immutable-tag ECR repository per image."
  type        = list(string)
  default     = []
}

variable "database" {
  type = object({
    engine_version        = optional(string, "16")
    instance_class        = optional(string, "db.t4g.medium")
    allocated_storage     = optional(number, 20)
    max_allocated_storage = optional(number, 100)
    multi_az              = optional(bool, false)
    backup_retention_days = optional(number, 7)
    deletion_protection   = optional(bool, true)
  })
  default = {}
}

variable "runtimes" {
  description = "One IAM role per runtime, bound to its ServiceAccount through EKS Pod Identity."
  type = map(object({
    namespace          = string
    service_account    = optional(string)
    bedrock_model_arns = optional(list(string), [])
    secret_names       = optional(list(string), [])
  }))
  default = {}

  validation {
    condition = alltrue([
      for r in values(var.runtimes) :
      alltrue([for arn in r.bedrock_model_arns : !strcontains(arn, "*")])
    ])
    error_message = "Bedrock model ARNs must be exact; wildcards are not allowed."
  }
}

variable "tags" {
  type    = map(string)
  default = {}
}
