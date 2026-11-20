output "repository_urls" {
  value = { for k, r in aws_ecr_repository.this : k => r.repository_url }
}

output "database_endpoint" {
  value = aws_db_instance.this.endpoint
}

output "database_master_secret_arn" {
  description = "The RDS-managed master credentials. Give migrations a role that may read it; runtimes should not."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}

output "runtime_role_arns" {
  value = { for k, r in aws_iam_role.runtime : k => r.arn }
}

output "secret_arns" {
  description = "Empty secrets to fill out of band; values never pass through Terraform state."
  value       = { for k, s in aws_secretsmanager_secret.this : k => s.arn }
}
