# The front door: one load balancer, the only thing the internet reaches,
# holding the one certificate. The relay answers at sync under the domain
# and the app at everything else; plain web traffic is sent to HTTPS. The
# domain's DNS zone is made once per account, as the state bucket is; see
# README.md.

data "aws_route53_zone" "site" {
  name = var.domain
}

# The domain and every name under it, so a computer's name, when there are
# computers, is covered by the same certificate.
resource "aws_acm_certificate" "site" {
  domain_name               = var.domain
  subject_alternative_names = ["*.${var.domain}"]
  validation_method         = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

# The domain and its wildcard are proved by the same record, written once.
resource "aws_route53_record" "proof" {
  for_each = {
    for o in aws_acm_certificate.site.domain_validation_options : o.domain_name => o
  }
  zone_id         = data.aws_route53_zone.site.zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 300
  allow_overwrite = true
}

# Amazon may issue certificates for the domain. Without a rule of its own
# the domain takes its parent's, which may name other issuers alone.
resource "aws_route53_record" "issuer" {
  zone_id = data.aws_route53_zone.site.zone_id
  name    = var.domain
  type    = "CAA"
  records = ["0 issue \"amazon.com\""]
  ttl     = 300
}

resource "aws_acm_certificate_validation" "site" {
  depends_on              = [aws_route53_record.issuer]
  certificate_arn         = aws_acm_certificate.site.arn
  validation_record_fqdns = [for r in aws_route53_record.proof : r.fqdn]
}

resource "aws_security_group" "door" {
  name        = "${var.name}-door"
  description = "The front door: in from anyone on the web ports"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${var.name}-door" }
}

resource "aws_vpc_security_group_ingress_rule" "door_in" {
  for_each          = toset(["80", "443"])
  security_group_id = aws_security_group.door.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = tonumber(each.key)
  to_port           = tonumber(each.key)
}

resource "aws_vpc_security_group_egress_rule" "door_to_app" {
  security_group_id            = aws_security_group.door.id
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 8080
  to_port                      = 8080
}

resource "aws_vpc_security_group_ingress_rule" "app_from_door" {
  security_group_id            = aws_security_group.app.id
  referenced_security_group_id = aws_security_group.door.id
  ip_protocol                  = "tcp"
  from_port                    = 8080
  to_port                      = 8080
}

# Live editing and a terminal hold a socket open with nothing said on it,
# so a quiet one is kept an hour, as Fly's proxy keeps one.
resource "aws_lb" "door" {
  name                       = var.name
  load_balancer_type         = "application"
  subnets                    = aws_subnet.public[*].id
  security_groups            = [aws_security_group.door.id]
  idle_timeout               = 3600
  drop_invalid_header_fields = true
  enable_deletion_protection = var.keep_on_destroy
}

resource "aws_lb_target_group" "app" {
  name                 = "${var.name}-app"
  vpc_id               = aws_vpc.main.id
  target_type          = "ip"
  protocol             = "HTTP"
  port                 = 8080
  deregistration_delay = 30
  health_check {
    path    = "/ping"
    matcher = "204"
  }
}

resource "aws_lb_target_group" "sync" {
  name                 = "${var.name}-sync"
  vpc_id               = aws_vpc.main.id
  target_type          = "ip"
  protocol             = "HTTP"
  port                 = 8080
  deregistration_delay = 30
  health_check {
    path    = "/"
    matcher = "200"
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.door.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      protocol    = "HTTPS"
      port        = "443"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.door.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.site.certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

resource "aws_lb_listener_rule" "sync" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10
  condition {
    host_header {
      values = ["sync.${var.domain}"]
    }
  }
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.sync.arn
  }
}

resource "aws_route53_record" "site" {
  for_each = toset([var.domain, "sync.${var.domain}", "*.${var.domain}"])
  zone_id  = data.aws_route53_zone.site.zone_id
  name     = each.key
  type     = "A"
  alias {
    name                   = aws_lb.door.dns_name
    zone_id                = aws_lb.door.zone_id
    evaluate_target_health = false
  }
}
