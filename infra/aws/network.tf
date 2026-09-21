# One private network across two of the region's data centres: public
# subnets for the front door and the app, which the internet reaches only
# through the front door, and private subnets for the database, which the
# internet never reaches. There is no NAT gateway: the app's containers sit
# in the public subnets with a public address, closed to everything but the
# front door, so nothing is paid by the hour for a way out.

locals {
  zones = slice(data.aws_availability_zones.here.names, 0, 2)
}

resource "aws_vpc" "main" {
  cidr_block           = "10.40.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = var.name }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = var.name }
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  availability_zone       = local.zones[count.index]
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  map_public_ip_on_launch = true
  tags                    = { Name = "${var.name}-public-${count.index}" }
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  availability_zone = local.zones[count.index]
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, 10 + count.index)
  tags              = { Name = "${var.name}-private-${count.index}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "${var.name}-public" }
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# The app's containers: only the front door may come in, as frontdoor.tf
# lets it. Out, they reach the web, since sign-in, mail and the models are
# services on it.
resource "aws_security_group" "app" {
  name        = "${var.name}-app"
  description = "The app containers: in only from the front door"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${var.name}-app" }
}

resource "aws_vpc_security_group_egress_rule" "app_out" {
  security_group_id = aws_security_group.app.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

# The database: in only from the app, on Postgres's port, and nothing out.
resource "aws_security_group" "database" {
  name        = "${var.name}-database"
  description = "The database: in only from the app"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${var.name}-database" }
}

resource "aws_vpc_security_group_ingress_rule" "database_from_app" {
  security_group_id            = aws_security_group.database.id
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}
