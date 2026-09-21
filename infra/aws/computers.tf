# What a person's computer stands on: the Linux it boots, the firewall it
# wears, and the identity it carries. The machines themselves are made by
# the app, one per person, and never by this template.

# The newest Amazon Linux, as AWS publishes it. A machine boots this and
# pulls the computer's image onto it, so an update is a pull and not a new
# machine image of ours.
data "aws_ssm_parameter" "computer_os" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

# In only from the front door, which is the one way to a computer. Out to
# the web, as on Fly: a person's computer fetches what they ask it to.
resource "aws_security_group" "computer" {
  name        = "${var.name}-computer"
  description = "A computer of one person: in only from the front door"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${var.name}-computer" }
}

resource "aws_vpc_security_group_ingress_rule" "computer_from_door" {
  security_group_id            = aws_security_group.computer.id
  referenced_security_group_id = aws_security_group.door.id
  ip_protocol                  = "tcp"
  from_port                    = 8080
  to_port                      = 8080
}

resource "aws_vpc_security_group_egress_rule" "computer_out" {
  security_group_id = aws_security_group.computer.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_vpc_security_group_egress_rule" "door_to_computer" {
  security_group_id            = aws_security_group.door.id
  referenced_security_group_id = aws_security_group.computer.id
  ip_protocol                  = "tcp"
  from_port                    = 8080
  to_port                      = 8080
}

# The identity a machine boots with. A person is an administrator of their
# own machine and can read it, so it may do one thing: fetch the computer's
# image, which is the image they are already running.
resource "aws_iam_role" "computer" {
  name = "${var.name}-computer"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "computer" {
  name = "pull"
  role = aws_iam_role.computer.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
        ]
        Resource = aws_ecr_repository.image["computer"].arn
      },
    ]
  })
}

resource "aws_iam_instance_profile" "computer" {
  name = "${var.name}-computer"
  role = aws_iam_role.computer.name
}
