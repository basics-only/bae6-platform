terraform {
  required_version = ">= 1.7"
}

provider "google" {
  project = "bae6-dev"
  region  = "us-central1"
}

module "bae6" {
  source = "../../modules/gke"

  name       = "bae6-dev"
  project    = "bae6-dev"
  region     = "us-central1"
  network_id = "projects/bae6-dev/global/networks/main"

  runtimes = {
    ai-gateway = {
      namespace    = "bae6"
      vertex       = true
      database     = true
      secret_names = ["database-url"]
    }
    context-data = {
      namespace    = "bae6"
      database     = true
      secret_names = ["database-url"]
    }
  }
}

output "runtime_service_account_emails" {
  value = module.bae6.runtime_service_account_emails
}
