mock_provider "google" {
  mock_resource "google_service_account" {
    defaults = {
      email = "runtime@bae6-prod.iam.gserviceaccount.com"
      name  = "projects/bae6-prod/serviceAccounts/runtime@bae6-prod.iam.gserviceaccount.com"
    }
  }
}

variables {
  name       = "bae6"
  project    = "bae6-prod"
  region     = "us-central1"
  network_id = "projects/bae6-prod/global/networks/main"
  runtimes = {
    ai-gateway = {
      namespace    = "bae6"
      vertex       = true
      database     = true
      secret_names = ["database-url"]
    }
    context-data = {
      namespace = "bae6"
    }
  }
}

run "images_cannot_be_overwritten" {
  command = apply

  assert {
    condition     = google_artifact_registry_repository.images.docker_config[0].immutable_tags
    error_message = "Image tags must be immutable."
  }
}

run "database_is_private_tls_only_iam_authenticated_and_protected_by_default" {
  command = apply

  assert {
    condition     = !google_sql_database_instance.this.settings[0].ip_configuration[0].ipv4_enabled && google_sql_database_instance.this.settings[0].ip_configuration[0].ssl_mode == "ENCRYPTED_ONLY"
    error_message = "Cloud SQL must have no public IP and accept only TLS."
  }

  assert {
    condition     = google_sql_database_instance.this.deletion_protection && google_sql_database_instance.this.settings[0].backup_configuration[0].enabled
    error_message = "The database must be delete-protected and backed up unless explicitly relaxed."
  }

  assert {
    condition     = [for f in google_sql_database_instance.this.settings[0].database_flags : f.value if f.name == "cloudsql.iam_authentication"] == ["on"]
    error_message = "IAM database authentication must be on so no database password exists."
  }
}

run "each_runtime_account_is_usable_only_from_its_own_kubernetes_service_account" {
  command = apply

  assert {
    condition     = google_service_account_iam_member.workload_identity["ai-gateway"].member == "serviceAccount:bae6-prod.svc.id.goog[bae6/ai-gateway]" && google_service_account_iam_member.workload_identity["ai-gateway"].role == "roles/iam.workloadIdentityUser"
    error_message = "Workload Identity must bind exactly namespace/serviceaccount."
  }
}

run "vertex_and_database_access_go_only_to_runtimes_that_ask" {
  command = apply

  assert {
    condition     = keys(google_project_iam_member.vertex) == ["ai-gateway"] && keys(google_project_iam_member.database_client) == ["ai-gateway"] && keys(google_sql_user.runtime) == ["ai-gateway"]
    error_message = "Only the runtime that declared vertex and database may get them."
  }

  assert {
    condition     = google_sql_user.runtime["ai-gateway"].type == "CLOUD_IAM_SERVICE_ACCOUNT" && google_sql_user.runtime["ai-gateway"].name == "runtime@bae6-prod.iam"
    error_message = "Database users must be IAM service accounts, named without the .gserviceaccount.com suffix."
  }
}

run "a_runtime_reads_only_its_own_secrets" {
  command = apply

  assert {
    condition     = keys(google_secret_manager_secret_iam_member.runtime) == ["ai-gateway/database-url"] && google_secret_manager_secret_iam_member.runtime["ai-gateway/database-url"].role == "roles/secretmanager.secretAccessor"
    error_message = "Secret access must be granted per secret to the declaring runtime only."
  }

  assert {
    condition     = google_secret_manager_secret.this["ai-gateway/database-url"].secret_id == "bae6-ai-gateway-database-url"
    error_message = "Secrets must be namespaced by runtime."
  }
}

run "a_runtime_account_id_over_30_characters_is_refused_before_apply" {
  command = plan

  variables {
    runtimes = {
      context-embedding-ingestion-worker = { namespace = "bae6" }
    }
  }

  expect_failures = [google_service_account.runtime]
}
