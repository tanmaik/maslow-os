-- A thing on a person's computer they have shared: a file or a folder,
-- named by the id its door marked it with, so a move or a rename on the
-- disk changes nothing here. Its name and kind are kept so what a
-- colleague was given is listed while the machine is off.
create table shared_files (
  id text primary key,
  org_id uuid not null default current_org() references orgs (id) on delete cascade,
  computer_id uuid not null references computers (id) on delete cascade,
  name text not null check (name <> ''),
  kind text not null check (kind in ('file', 'dir')),
  unique (computer_id, id)
);
alter table shared_files enable row level security;
alter table shared_files force row level security;

-- Who may reach a shared file or folder, the way a port is given: to a
-- person, to a group, or to everyone in the org, at view or edit. Only the
-- computer's owner gives and takes; everyone can only be given view.
create table file_shares (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default current_org() references orgs (id) on delete cascade,
  computer_id uuid not null references computers (id) on delete cascade,
  file_id text not null,
  subject text not null check (subject in ('everyone', 'group', 'member')),
  member_id uuid,
  group_id uuid,
  level text not null check (level in ('view', 'edit')),
  constraint file_share_names_its_subject check (
    case subject
      when 'member' then member_id is not null and group_id is null
      when 'group' then group_id is not null and member_id is null
      else member_id is null and group_id is null
    end),
  constraint everyone_only_views check (subject <> 'everyone' or level = 'view'),
  foreign key (computer_id, file_id) references shared_files (computer_id, id) on delete cascade,
  foreign key (org_id, member_id) references users (org_id, id) on delete cascade,
  foreign key (org_id, group_id) references groups (org_id, id) on delete cascade
);
create unique index file_shares_one_per_subject on file_shares
  (file_id, subject, coalesce(member_id, group_id, computer_id));
alter table file_shares enable row level security;
alter table file_shares force row level security;

create policy see on file_shares for select
  using (org_id = current_org()
    and (computer_id in
          (select c.id from computers c where c.user_id = current_member())
      or subject = 'everyone'
      or member_id = current_member()
      or exists (select 1 from group_members m
                 where m.group_id = file_shares.group_id
                   and m.member_id = current_member())));
create policy give on file_shares for insert
  with check (org_id = current_org()
    and computer_id in
      (select c.id from computers c where c.user_id = current_member()));
create policy take on file_shares for delete
  using (org_id = current_org()
    and computer_id in
      (select c.id from computers c where c.user_id = current_member()));
-- A party given a thing again at a higher level rises to it.
create policy raise on file_shares for update
  using (org_id = current_org()
    and computer_id in
      (select c.id from computers c where c.user_id = current_member()))
  with check (org_id = current_org()
    and computer_id in
      (select c.id from computers c where c.user_id = current_member()));
grant select, insert, update, delete on file_shares to app;

-- The most a shared file lets the member reading do: owner on their own
-- computer's, else the highest level any share reaches them at, else
-- nothing.
create function file_level(file text) returns text
  language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from shared_files f join computers c on c.id = f.computer_id
                 where f.id = file and f.org_id = current_org()
                   and c.user_id = current_member()) then 'owner'
    else (select case max(case s.level when 'edit' then 2 else 1 end)
                   when 2 then 'edit' when 1 then 'view' end
          from file_shares s
          where s.file_id = file and s.org_id = current_org()
            and (s.subject = 'everyone'
              or s.member_id = current_member()
              or exists (select 1 from group_members m
                         where m.group_id = s.group_id
                           and m.member_id = current_member())))
  end
$$;
revoke all on function file_level(text) from public;
grant execute on function file_level(text) to app;

-- The owner sees every shared thing of theirs and gives, changes and
-- takes them; anyone else sees what reaches them.
create policy see on shared_files for select
  using (org_id = current_org() and file_level(id) is not null);
create policy own on shared_files for all
  using (org_id = current_org()
    and computer_id in
      (select c.id from computers c where c.user_id = current_member()))
  with check (org_id = current_org()
    and computer_id in
      (select c.id from computers c where c.user_id = current_member()));
grant select, insert, update, delete on shared_files to app;

-- The copy of a shared thing in the bucket, an object per file: the file
-- itself, or one under a shared folder by its path there. A copy a
-- colleague wrote is pending until the owner's door has taken it onto the
-- disk. The owner and whoever may edit write these rows.
create table file_copies (
  org_id uuid not null default current_org() references orgs (id) on delete cascade,
  file_id text not null references shared_files (id) on delete cascade,
  path text not null default '',
  key text not null unique,
  bytes bigint not null check (bytes >= 0),
  modified timestamptz not null,
  pending boolean not null default false,
  primary key (file_id, path)
);
alter table file_copies enable row level security;
alter table file_copies force row level security;
create policy see on file_copies for select
  using (org_id = current_org() and file_level(file_id) is not null);
create policy change on file_copies for all
  using (org_id = current_org() and file_level(file_id) in ('owner', 'edit'))
  with check (org_id = current_org() and file_level(file_id) in ('owner', 'edit'));
grant select, insert, update, delete on file_copies to app;

-- A copy's object is owed its deletion the moment its row goes, whichever
-- way it goes: the share ended, the file was deleted, the computer or the
-- org went; and the moment its row names a newer object instead. Written
-- in the same transaction, so a cascade leaves nothing behind that costs
-- money.
alter table orphans drop constraint orphans_kind_check;
alter table orphans add constraint orphans_kind_check
  check (kind in ('accounts', 'picture', 'computer', 'copy'));
create function file_copy_owed() returns trigger
  language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    insert into orphans (org_id, kind, ref, user_id) values (old.org_id, 'copy', old.key, null);
    return old;
  end if;
  if old.key <> new.key then
    insert into orphans (org_id, kind, ref, user_id) values (old.org_id, 'copy', old.key, null);
  end if;
  return new;
end
$$;
create trigger owed after delete or update of key on file_copies
  for each row execute function file_copy_owed();

-- A share landing tells the person it reached: a note left for them by
-- the one who shared, in that person's name. Nothing else of anyone
-- else's is ever written or read here.
create policy tell on notifications for insert
  with check (org_id = current_org() and kind = 'note'
    and person_id in (select id from users where org_id = current_org()));

