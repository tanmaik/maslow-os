variable "name" {
  description = "What this deployment is called; every resource's name starts with it."
  type        = string
  default     = "maslow-test"
}

variable "region" {
  description = "The AWS region everything is built in."
  type        = string
  default     = "us-east-2"
}

variable "domain" {
  description = "The name people reach Maslow at, such as maslow.example.com, whose DNS zone is in this account. The relay answers at sync under it."
  type        = string
}

variable "release" {
  description = "The release the app and the relay run: the tag their images were built with. Until one is named, nothing runs."
  type        = string
  default     = ""
}

variable "database_size" {
  description = "The database's instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "database_gb" {
  description = "The database's disk, in gigabytes; it grows on its own up to four times this."
  type        = number
  default     = 20
}

variable "keep_on_destroy" {
  description = "Whether taking the deployment down keeps a last copy of the database and refuses to delete it by accident. Off for a test account, on for a customer's."
  type        = bool
  default     = false
}
