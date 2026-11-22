terraform {
  required_version = ">= 1.7"
}

provider "aws" {
  region = "us-east-1"
}

module "bae6" {
  source = "../../modules/eks"

  name                               = "bae6-dev"
  cluster_name                       = "main"
  vpc_id                             = "vpc-0123456789abcdef0"
  database_subnet_ids                = ["subnet-0123456789abcdef0", "subnet-0fedcba9876543210"]
  database_client_security_group_ids = ["sg-0123456789abcdef0"]
  repositories                       = ["ai-gateway", "context-data"]

  runtimes = {
    ai-gateway = {
      namespace          = "bae6"
      bedrock_model_arns = ["arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-5-sonnet-20241022-v2:0"]
      secret_names       = ["database-url"]
    }
    context-data = {
      namespace    = "bae6"
      secret_names = ["database-url"]
    }
  }
}

output "runtime_role_arns" {
  value = module.bae6.runtime_role_arns
}
