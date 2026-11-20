mock_provider "aws" {
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111111111111:role/runtime" }
  }

  mock_resource "aws_secretsmanager_secret" {
    defaults = { arn = "arn:aws:secretsmanager:us-east-1:111111111111:secret:runtime" }
  }

  override_resource {
    target = aws_db_instance.this
    values = {
      endpoint           = "db.example:5432"
      master_user_secret = [{ secret_arn = "arn:aws:secretsmanager:us-east-1:111111111111:secret:rds-master" }]
    }
  }
}

variables {
  name                               = "bae6"
  cluster_name                       = "main"
  vpc_id                             = "vpc-1"
  database_subnet_ids                = ["subnet-a", "subnet-b"]
  database_client_security_group_ids = ["sg-nodes"]
  repositories                       = ["ai-gateway", "context-data"]
  runtimes = {
    ai-gateway = {
      namespace          = "bae6"
      bedrock_model_arns = ["arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-sonnet"]
      secret_names       = ["database-url"]
    }
    context-data = {
      namespace = "bae6"
    }
  }
}

run "images_cannot_be_overwritten_and_are_scanned" {
  command = apply

  assert {
    condition     = alltrue([for r in aws_ecr_repository.this : r.image_tag_mutability == "IMMUTABLE" && r.image_scanning_configuration[0].scan_on_push])
    error_message = "ECR repositories must be immutable and scan on push."
  }
}

run "database_is_private_encrypted_and_protected_by_default" {
  command = apply

  assert {
    condition     = !aws_db_instance.this.publicly_accessible && aws_db_instance.this.storage_encrypted && aws_db_instance.this.deletion_protection
    error_message = "The database must be private, encrypted and delete-protected unless explicitly relaxed."
  }

  assert {
    condition     = aws_db_instance.this.manage_master_user_password
    error_message = "The master password must be managed by RDS, never held in state."
  }
}

run "only_the_named_security_groups_reach_the_database" {
  command = apply

  assert {
    condition     = alltrue([for r in aws_vpc_security_group_ingress_rule.database : r.from_port == 5432 && r.to_port == 5432 && r.cidr_ipv4 == null])
    error_message = "Database ingress must be 5432 from security groups only."
  }
}

run "a_runtime_may_invoke_only_its_listed_models" {
  command = apply

  assert {
    condition     = jsondecode(aws_iam_role_policy.bedrock["ai-gateway"].policy).Statement[0].Resource == ["arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-sonnet"]
    error_message = "The Bedrock policy must name exactly the listed model ARNs."
  }

  assert {
    condition     = !contains(keys(aws_iam_role_policy.bedrock), "context-data")
    error_message = "A runtime without models must get no Bedrock access."
  }
}

run "roles_are_assumed_only_by_pod_identity_and_bound_to_the_runtimes_own_service_account" {
  command = apply

  assert {
    condition     = jsondecode(aws_iam_role.runtime["ai-gateway"].assume_role_policy).Statement[0].Principal.Service == "pods.eks.amazonaws.com"
    error_message = "Roles must trust EKS Pod Identity only."
  }

  assert {
    condition     = aws_eks_pod_identity_association.runtime["ai-gateway"].service_account == "ai-gateway" && aws_eks_pod_identity_association.runtime["context-data"].namespace == "bae6"
    error_message = "Each runtime's role must bind to its own ServiceAccount."
  }
}

run "a_runtime_reads_only_its_own_secrets" {
  command = apply

  assert {
    condition     = length(aws_iam_role_policy.secrets) == 1 && contains(keys(aws_iam_role_policy.secrets), "ai-gateway")
    error_message = "Only runtimes that declare secrets get secret access."
  }

  assert {
    condition     = aws_secretsmanager_secret.this["ai-gateway/database-url"].name == "bae6/ai-gateway/database-url"
    error_message = "Secrets must be namespaced by runtime."
  }
}

run "wildcard_model_arns_are_refused" {
  command = plan

  variables {
    runtimes = {
      ai-gateway = {
        namespace          = "bae6"
        bedrock_model_arns = ["arn:aws:bedrock:*::foundation-model/*"]
      }
    }
  }

  expect_failures = [var.runtimes]
}

run "a_database_without_clients_is_refused" {
  command = plan

  variables {
    database_client_security_group_ids = []
  }

  expect_failures = [var.database_client_security_group_ids]
}
