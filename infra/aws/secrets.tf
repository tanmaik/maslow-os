# What the app is given as it starts, kept in Secrets Manager. Two
# secrets: what this template makes and knows — the database's addresses,
# the store's key, the relay's and the sweep's secrets — and the keys of
# outside services, which the operator enters once and the template never
# overwrites. A secret deleted here is gone at once rather than held for a
# week, so a test account can be taken down and built again.

resource "random_password" "sync" {
  length  = 48
  special = false
}

resource "random_password" "cron" {
  length  = 48
  special = false
}

locals {
  database = "${aws_db_instance.main.address}:${aws_db_instance.main.port}/${aws_db_instance.main.db_name}?sslmode=verify-full"
}

resource "aws_secretsmanager_secret" "app" {
  name                    = "${var.name}/app"
  description             = "What the template made for the app: the database, the store, the relay and the sweep."
  recovery_window_in_days = var.keep_on_destroy ? 30 : 0
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    DATABASE_OWNER_URL = "postgres://${aws_db_instance.main.username}:${random_password.database_owner.result}@${local.database}"
    DATABASE_URL       = "postgres://app:${random_password.database_app.result}@${local.database}"
    STORAGE_ENDPOINT   = "https://s3.${var.region}.amazonaws.com"
    STORAGE_REGION     = var.region
    STORAGE_BUCKET     = aws_s3_bucket.files.bucket
    STORAGE_ACCESS_KEY = aws_iam_access_key.app.id
    STORAGE_SECRET_KEY = aws_iam_access_key.app.secret
    SYNC_SECRET        = random_password.sync.result
    CRON_SECRET        = random_password.cron.result
    APP_URL            = local.site
  })
}

resource "aws_secretsmanager_secret" "vendors" {
  name                    = "${var.name}/vendors"
  description             = "Keys of outside services, entered by the operator: sign-in and mail."
  recovery_window_in_days = var.keep_on_destroy ? 30 : 0
}

resource "aws_secretsmanager_secret_version" "vendors" {
  secret_id = aws_secretsmanager_secret.vendors.id
  secret_string = jsonencode({
    WORKOS_API_KEY   = ""
    WORKOS_CLIENT_ID = ""
    RESEND_API_KEY   = ""
    MAIL_FROM        = ""
  })

  # Entered by the operator after the first run; never set back to blank.
  lifecycle {
    ignore_changes = [secret_string]
  }
}
