# The database: Postgres in the private subnets, encrypted, backed up
# every day and kept seven, and never reachable from the internet. The
# owner it is made with runs the migrations; the app connects as the
# restricted `app` role, which the app makes with SQL as it first starts.

resource "aws_db_subnet_group" "main" {
  name       = var.name
  subnet_ids = aws_subnet.private[*].id
}

resource "random_password" "database_owner" {
  length  = 32
  special = false
}

resource "random_password" "database_app" {
  length  = 32
  special = false
}

resource "aws_db_instance" "main" {
  identifier     = var.name
  engine         = "postgres"
  engine_version = "18"
  instance_class = var.database_size

  allocated_storage     = var.database_gb
  max_allocated_storage = var.database_gb * 4
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "maslow"
  username = "maslow_owner"
  password = random_password.database_owner.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.database.id]
  publicly_accessible    = false

  backup_retention_period    = 7
  auto_minor_version_upgrade = true
  deletion_protection        = var.keep_on_destroy
  skip_final_snapshot        = !var.keep_on_destroy
  final_snapshot_identifier  = var.keep_on_destroy ? "${var.name}-final" : null
}
