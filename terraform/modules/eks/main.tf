locals {
  secrets = merge([
    for runtime, r in var.runtimes : {
      for s in r.secret_names : "${runtime}/${s}" => { runtime = runtime, name = "${var.name}/${runtime}/${s}" }
    }
  ]...)
}

resource "aws_ecr_repository" "this" {
  for_each             = toset(var.repositories)
  name                 = "${var.name}/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  tags                 = var.tags

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.database_subnet_ids
  tags       = var.tags
}

resource "aws_security_group" "database" {
  name_prefix = "${var.name}-database-"
  vpc_id      = var.vpc_id
  tags        = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "database" {
  for_each                     = toset(var.database_client_security_group_ids)
  security_group_id            = aws_security_group.database.id
  referenced_security_group_id = each.key
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_db_instance" "this" {
  identifier                  = var.name
  engine                      = "postgres"
  engine_version              = var.database.engine_version
  instance_class              = var.database.instance_class
  allocated_storage           = var.database.allocated_storage
  max_allocated_storage       = var.database.max_allocated_storage
  storage_encrypted           = true
  multi_az                    = var.database.multi_az
  backup_retention_period     = var.database.backup_retention_days
  deletion_protection         = var.database.deletion_protection
  skip_final_snapshot         = false
  final_snapshot_identifier   = coalesce(var.database.final_snapshot_name, "${var.name}-final")
  publicly_accessible         = false
  username                    = "bae6_admin"
  manage_master_user_password = true
  auto_minor_version_upgrade  = true
  db_subnet_group_name        = aws_db_subnet_group.this.name
  vpc_security_group_ids      = [aws_security_group.database.id]
  tags                        = var.tags
}

resource "aws_iam_role" "runtime" {
  for_each = var.runtimes
  name     = "${var.name}-${each.key}"
  tags     = var.tags

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "pods.eks.amazonaws.com" }
      Action    = ["sts:AssumeRole", "sts:TagSession"]
    }]
  })
}

resource "aws_eks_pod_identity_association" "runtime" {
  for_each        = var.runtimes
  cluster_name    = var.cluster_name
  namespace       = each.value.namespace
  service_account = coalesce(each.value.service_account, each.key)
  role_arn        = aws_iam_role.runtime[each.key].arn
  tags            = var.tags
}

resource "aws_iam_role_policy" "bedrock" {
  for_each = { for k, r in var.runtimes : k => r if length(r.bedrock_model_arns) > 0 }
  name     = "bedrock-invoke"
  role     = aws_iam_role.runtime[each.key].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
      Resource = each.value.bedrock_model_arns
    }]
  })
}

resource "aws_secretsmanager_secret" "this" {
  for_each = local.secrets
  name     = each.value.name
  tags     = var.tags

  recovery_window_in_days = var.secret_recovery_window_days
}

resource "aws_iam_role_policy" "secrets" {
  for_each = { for k, r in var.runtimes : k => r if length(r.secret_names) > 0 }
  name     = "read-own-secrets"
  role     = aws_iam_role.runtime[each.key].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [for s in each.value.secret_names : aws_secretsmanager_secret.this["${each.key}/${s}"].arn]
    }]
  })
}
