-- When a computer's home was last archived into the bucket.
alter table computers
  add column backed_up_at timestamptz;
