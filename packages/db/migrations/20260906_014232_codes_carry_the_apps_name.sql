-- A code carries the name of the app it was approved for, so trading it in
-- needs nothing fetched: what the person saw on the consent page is what
-- the session is named.
alter table oauth_codes add column client_name text not null default '';
