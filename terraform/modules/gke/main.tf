locals {
  secrets = merge([
    for runtime, r in var.runtimes : {
      for s in r.secret_names : "${runtime}/${s}" => { runtime = runtime, id = "${var.name}--${runtime}--${s}" }
    }
  ]...)
}

resource "google_artifact_registry_repository" "images" {
  project       = var.project
  location      = var.region
  repository_id = var.name
  format        = "DOCKER"
  labels        = var.labels

  docker_config {
    immutable_tags = true
  }
}

resource "google_sql_database_instance" "this" {
  project             = var.project
  region              = var.region
  name                = var.name
  database_version    = var.database.version
  deletion_protection = var.database.deletion_protection

  settings {
    tier                        = var.database.tier
    disk_size                   = var.database.disk_size_gb
    disk_autoresize             = true
    availability_type           = var.database.availability_type
    deletion_protection_enabled = var.database.deletion_protection
    user_labels                 = var.labels

    ip_configuration {
      ipv4_enabled    = false
      private_network = var.network_id
      ssl_mode        = "ENCRYPTED_ONLY"
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
    }

    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "on"
    }
  }
}

resource "google_service_account" "runtime" {
  for_each     = var.runtimes
  project      = var.project
  account_id   = "${var.name}-${each.key}"
  display_name = "${var.name} ${each.key}"

  lifecycle {
    precondition {
      condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", "${var.name}-${each.key}"))
      error_message = "Google service account ids are 6 to 30 lowercase letters, digits and hyphens, starting with a letter; adjust name or the runtime key."
    }
  }
}

resource "google_service_account_iam_member" "workload_identity" {
  for_each           = var.runtimes
  service_account_id = google_service_account.runtime[each.key].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${coalesce(var.cluster_project, var.project)}.svc.id.goog[${each.value.namespace}/${coalesce(each.value.service_account, each.key)}]"
}

resource "google_project_iam_member" "vertex" {
  for_each = { for k, r in var.runtimes : k => r if r.vertex }
  project  = var.project
  role     = "roles/aiplatform.user"
  member   = "serviceAccount:${google_service_account.runtime[each.key].email}"
}

resource "google_project_iam_member" "database_client" {
  for_each = { for k, r in var.runtimes : k => r if r.database }
  project  = var.project
  role     = "roles/cloudsql.client"
  member   = "serviceAccount:${google_service_account.runtime[each.key].email}"

  condition {
    title      = "${var.name} instance only"
    expression = "resource.type == \"sqladmin.googleapis.com/Instance\" && resource.name == \"projects/${var.project}/instances/${google_sql_database_instance.this.name}\""
  }
}

resource "google_project_iam_member" "database_login" {
  for_each = { for k, r in var.runtimes : k => r if r.database }
  project  = var.project
  role     = "roles/cloudsql.instanceUser"
  member   = "serviceAccount:${google_service_account.runtime[each.key].email}"

  condition {
    title      = "${var.name} instance only"
    expression = "resource.type == \"sqladmin.googleapis.com/Instance\" && resource.name == \"projects/${var.project}/instances/${google_sql_database_instance.this.name}\""
  }
}

resource "google_sql_user" "runtime" {
  for_each = { for k, r in var.runtimes : k => r if r.database }
  project  = var.project
  instance = google_sql_database_instance.this.name
  name     = trimsuffix(google_service_account.runtime[each.key].email, ".gserviceaccount.com")
  type     = "CLOUD_IAM_SERVICE_ACCOUNT"
}

resource "google_sql_database" "runtime" {
  for_each = { for k, r in var.runtimes : k => r if r.database }
  project  = var.project
  instance = google_sql_database_instance.this.name
  name     = replace(each.key, "-", "_")
}

resource "google_secret_manager_secret" "this" {
  for_each  = local.secrets
  project   = var.project
  secret_id = each.value.id
  labels    = var.labels

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_iam_member" "runtime" {
  for_each  = local.secrets
  project   = var.project
  secret_id = google_secret_manager_secret.this[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime[each.value.runtime].email}"
}
