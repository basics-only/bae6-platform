output "registry" {
  value = "${var.region}-docker.pkg.dev/${var.project}/${google_artifact_registry_repository.images.repository_id}"
}

output "database_connection_name" {
  value = google_sql_database_instance.this.connection_name
}

output "database_private_ip" {
  value = google_sql_database_instance.this.private_ip_address
}

output "runtime_service_account_emails" {
  description = "Set as the iam.gke.io/gcp-service-account annotation on the runtime's ServiceAccount."
  value       = { for k, s in google_service_account.runtime : k => s.email }
}

output "secret_ids" {
  description = "Empty secrets to fill out of band; values never pass through Terraform state."
  value       = { for k, s in google_secret_manager_secret.this : k => s.secret_id }
}
