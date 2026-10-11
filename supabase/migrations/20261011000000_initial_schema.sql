create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique check (username is null or username ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null default '' check (char_length(display_name) <= 80),
  avatar_url text,
  home_city text check (char_length(home_city) <= 120),
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'blocked')),
  created_at timestamptz not null default now(),
  unique (requester_id, recipient_id),
  check (requester_id <> recipient_id)
);
create index friendships_recipient_status_idx on public.friendships(recipient_id, status);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  created_by uuid not null references auth.users(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.group_invitations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  invited_user_id uuid not null references auth.users(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  unique (group_id, invited_user_id)
);
create index group_invitations_user_status_idx on public.group_invitations(invited_user_id, status);

create table public.push_tokens (
  user_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null unique check (expo_push_token ~ '^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$'),
  created_at timestamptz not null default now(),
  primary key(user_id, expo_push_token)
);

create table public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('organizer', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_members_user_idx on public.group_members(user_id, group_id);

create function public.add_group_creator()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.group_members(group_id, user_id, role)
  values (new.id, new.created_by, 'organizer');
  return new;
end;
$$;
create trigger groups_add_creator after insert on public.groups
for each row execute function public.add_group_creator();

create function public.accept_group_invitation(invitation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare invite public.group_invitations;
begin
  select * into invite from public.group_invitations
  where id = invitation_id and invited_user_id = auth.uid() and status = 'pending'
  for update;
  if not found then raise exception 'Invitation not found'; end if;
  update public.group_invitations set status = 'accepted' where id = invite.id;
  insert into public.group_members(group_id, user_id, role)
  values (invite.group_id, auth.uid(), 'member')
  on conflict (group_id, user_id) do nothing;
end;
$$;
revoke all on function public.accept_group_invitation(uuid) from public;
grant execute on function public.accept_group_invitation(uuid) to authenticated;

create table public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google', 'apple', 'android')),
  connection_status text not null default 'disconnected'
    check (connection_status in ('connected', 'disconnected', 'revoked', 'error')),
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, provider)
);

-- OAuth tokens are server-only, envelope-encrypted, and never exposed to client roles.
create table public.calendar_provider_tokens (
  connection_id uuid primary key references public.calendar_connections(id) on delete cascade,
  encrypted_token bytea not null,
  key_version text not null,
  updated_at timestamptz not null default now()
);
create table public.oauth_state_nonces (
  nonce text primary key,
  expires_at timestamptz not null
);

create table public.places (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_place_id text not null,
  name text not null,
  address text not null,
  latitude double precision,
  longitude double precision,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider, provider_place_id),
  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180)
);

create table public.hangouts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  title text not null check (char_length(title) between 1 and 100),
  description text not null default '',
  city text not null default '',
  destination_id uuid references public.places(id) on delete set null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  timezone text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'cancelled', 'completed')),
  budget_estimate text,
  itinerary jsonb not null default '[]'::jsonb,
  plan_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at)
);
create index hangouts_group_start_idx on public.hangouts(group_id, start_at);

create table public.hangout_members (
  hangout_id uuid not null references public.hangouts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rsvp_status text not null default 'pending' check (rsvp_status in ('pending', 'going', 'maybe', 'declined')),
  responded_at timestamptz,
  primary key (hangout_id, user_id)
);
create index hangout_members_user_idx on public.hangout_members(user_id, hangout_id);

create table public.quests (
  id uuid primary key default gen_random_uuid(),
  hangout_id uuid not null references public.hangouts(id) on delete cascade,
  description text not null check (char_length(description) between 1 and 300),
  completion_type text not null default 'self_report' check (completion_type in ('self_report', 'photo_optional')),
  is_optional boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.quest_completions (
  quest_id uuid not null references public.quests(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  completed_at timestamptz not null default now(),
  private_photo_path text,
  primary key (quest_id, user_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  hangout_id uuid references public.hangouts(id) on delete cascade,
  type text not null check (char_length(type) between 1 and 60),
  sent_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_sent_idx on public.notifications(user_id, sent_at desc);

create table public.blocked_users (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.groups enable row level security;
alter table public.group_invitations enable row level security;
alter table public.group_members enable row level security;
alter table public.calendar_connections enable row level security;
alter table public.calendar_provider_tokens enable row level security;
alter table public.places enable row level security;
alter table public.hangouts enable row level security;
alter table public.hangout_members enable row level security;
alter table public.quests enable row level security;
alter table public.quest_completions enable row level security;
alter table public.notifications enable row level security;
alter table public.blocked_users enable row level security;
alter table public.push_tokens enable row level security;
alter table public.oauth_state_nonces enable row level security;
revoke all on public.calendar_provider_tokens from anon, authenticated;
grant all on public.calendar_provider_tokens to service_role;

create function public.prevent_relationship_retargeting()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'friendships'
    and (new.requester_id is distinct from old.requester_id or new.recipient_id is distinct from old.recipient_id) then
    raise exception 'Friend request participants cannot be changed';
  elsif tg_table_name = 'group_invitations'
    and (new.group_id is distinct from old.group_id
      or new.invited_user_id is distinct from old.invited_user_id
      or new.invited_by is distinct from old.invited_by) then
    raise exception 'Group invitation participants cannot be changed';
  elsif tg_table_name = 'group_members'
    and (new.group_id is distinct from old.group_id or new.user_id is distinct from old.user_id) then
    raise exception 'Group membership identity cannot be changed';
  elsif tg_table_name = 'hangouts'
    and (new.group_id is distinct from old.group_id or new.created_by is distinct from old.created_by) then
    raise exception 'Hangout ownership cannot be changed';
  end if;
  return new;
end;
$$;
create trigger friendships_identity_immutable before update on public.friendships
for each row execute function public.prevent_relationship_retargeting();
create trigger group_invitations_identity_immutable before update on public.group_invitations
for each row execute function public.prevent_relationship_retargeting();
create trigger group_members_identity_immutable before update on public.group_members
for each row execute function public.prevent_relationship_retargeting();
create trigger hangouts_identity_immutable before update on public.hangouts
for each row execute function public.prevent_relationship_retargeting();

create function public.create_profile_for_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  return new;
end;
$$;
create trigger auth_user_profile_created after insert on auth.users
for each row execute function public.create_profile_for_new_user();

-- Security-definer predicates avoid recursive RLS when a policy checks membership.
create function public.is_group_member(target_group_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = target_group_id and gm.user_id = target_user_id
  );
$$;
create function public.is_group_organizer(target_group_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = target_group_id and gm.user_id = target_user_id and gm.role = 'organizer'
  );
$$;
create function public.are_accepted_friends(first_user uuid, second_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.requester_id = first_user and f.recipient_id = second_user)
        or (f.recipient_id = first_user and f.requester_id = second_user))
  );
$$;
revoke all on function public.is_group_member(uuid, uuid) from public;
revoke all on function public.is_group_organizer(uuid, uuid) from public;
revoke all on function public.are_accepted_friends(uuid, uuid) from public;
grant execute on function public.is_group_member(uuid, uuid) to authenticated;
grant execute on function public.is_group_organizer(uuid, uuid) to authenticated;
grant execute on function public.are_accepted_friends(uuid, uuid) to authenticated;

create policy "profiles visible to self and accepted friends" on public.profiles for select to authenticated
using (id = (select auth.uid()) or public.are_accepted_friends((select auth.uid()), profiles.id));
create function public.search_profiles_by_username(search_username text)
returns table(id uuid, username text, display_name text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.username, p.display_name
  from public.profiles p
  where auth.uid() is not null and p.username is not null
    and p.username like lower(search_username) || '%'
    and p.id <> auth.uid()
    and not exists (
      select 1 from public.blocked_users b
      where (b.blocker_id = auth.uid() and b.blocked_id = p.id)
        or (b.blocker_id = p.id and b.blocked_id = auth.uid())
    )
  order by p.username limit 10;
$$;
revoke all on function public.search_profiles_by_username(text) from public;
grant execute on function public.search_profiles_by_username(text) to authenticated;
create policy "users create own profile" on public.profiles for insert to authenticated
with check (id = (select auth.uid()));
create policy "users update own profile" on public.profiles for update to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "friendships visible to participants" on public.friendships for select to authenticated
using (requester_id = (select auth.uid()) or recipient_id = (select auth.uid()));
create policy "users send friend request" on public.friendships for insert to authenticated
with check (requester_id = (select auth.uid()) and status = 'pending');
create policy "recipient accepts or declines request" on public.friendships for update to authenticated
using (recipient_id = (select auth.uid()) and status = 'pending')
with check (recipient_id = (select auth.uid()) and status in ('accepted', 'declined', 'blocked'));
create policy "requester removes request" on public.friendships for delete to authenticated
using (requester_id = (select auth.uid()) or recipient_id = (select auth.uid()));

create policy "group members read groups" on public.groups for select to authenticated
using (exists (select 1 from public.group_members gm where gm.group_id = groups.id and gm.user_id = (select auth.uid())));
create policy "authenticated users create groups" on public.groups for insert to authenticated
with check (created_by = (select auth.uid()));
create policy "organizers update groups" on public.groups for update to authenticated
using (exists (select 1 from public.group_members gm where gm.group_id = groups.id and gm.user_id = (select auth.uid()) and gm.role = 'organizer'))
with check (created_by = (select auth.uid()));
create policy "organizers delete groups" on public.groups for delete to authenticated
using (created_by = (select auth.uid()));

create policy "members view group invitations" on public.group_invitations for select to authenticated
using (invited_user_id = (select auth.uid()) or exists (
  select 1 from public.group_members gm where gm.group_id = group_invitations.group_id and gm.user_id = (select auth.uid())
));
create policy "organizers invite members" on public.group_invitations for insert to authenticated
with check (invited_by = (select auth.uid()) and exists (
  select 1 where public.is_group_organizer(group_invitations.group_id, (select auth.uid()))
) and public.are_accepted_friends((select auth.uid()), invited_user_id));
create policy "invitee accepts invitation" on public.group_invitations for update to authenticated
using (invited_user_id = (select auth.uid()) and status = 'pending')
with check (invited_user_id = (select auth.uid()) and status in ('accepted', 'declined'));

create policy "group members view membership" on public.group_members for select to authenticated
using (public.is_group_member(group_members.group_id, (select auth.uid())));
create policy "organizers manage memberships" on public.group_members for delete to authenticated
using (public.is_group_organizer(group_members.group_id, (select auth.uid()))
  or user_id = (select auth.uid()));
-- Creator membership is inserted by a trigger; new members are added only by the invitation RPC.

create policy "users manage own calendar connection metadata" on public.calendar_connections for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- No client policy is defined for calendar_provider_tokens: only trusted server credentials can access it.
create policy "signed-in users read verified places" on public.places for select to authenticated using (true);

create policy "group members read hangouts" on public.hangouts for select to authenticated
using (public.is_group_member(hangouts.group_id, (select auth.uid())));
create policy "organizers create hangout drafts" on public.hangouts for insert to authenticated
with check (created_by = (select auth.uid()) and status = 'draft' and public.is_group_organizer(hangouts.group_id, (select auth.uid())));
create policy "organizers update hangouts" on public.hangouts for update to authenticated
using (created_by = (select auth.uid()) and public.is_group_organizer(hangouts.group_id, (select auth.uid())))
with check (created_by = (select auth.uid()) and status = 'draft' and public.is_group_organizer(hangouts.group_id, (select auth.uid())));
create policy "organizers delete hangouts" on public.hangouts for delete to authenticated
using (created_by = (select auth.uid()) and status = 'draft' and public.is_group_organizer(hangouts.group_id, (select auth.uid())));

create function public.publish_hangout(target_hangout_id uuid)
returns public.hangouts language plpgsql security definer set search_path = '' as $$
declare published public.hangouts;
begin
  update public.hangouts h
  set status = 'published', updated_at = now()
  where h.id = target_hangout_id and h.created_by = auth.uid() and h.status = 'draft'
    and public.is_group_organizer(h.group_id, auth.uid())
  returning h.* into published;
  if not found then raise exception 'Draft not found or organizer permission required'; end if;
  insert into public.hangout_members(hangout_id, user_id)
    select target_hangout_id, gm.user_id from public.group_members gm
    where gm.group_id = published.group_id on conflict do nothing;
  insert into public.notifications(user_id, hangout_id, type)
    select gm.user_id, target_hangout_id, 'hangout_invitation'
    from public.group_members gm where gm.group_id = published.group_id and gm.user_id <> auth.uid();
  return published;
end;
$$;
revoke all on function public.publish_hangout(uuid) from public;
grant execute on function public.publish_hangout(uuid) to authenticated;

create policy "group members read hangout RSVPs" on public.hangout_members for select to authenticated
using (exists (
  select 1 from public.hangouts h
  where h.id = hangout_members.hangout_id and public.is_group_member(h.group_id, (select auth.uid()))
));
create policy "organizers invite group members to hangout" on public.hangout_members for insert to authenticated
with check (exists (
  select 1 from public.hangouts h
  where h.id = hangout_members.hangout_id and public.is_group_organizer(h.group_id, (select auth.uid()))
) and exists (select 1 from public.hangouts h
  where h.id = hangout_members.hangout_id and public.is_group_member(h.group_id, hangout_members.user_id)));
create policy "members update own RSVP" on public.hangout_members for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()) and rsvp_status in ('going', 'maybe', 'declined'));
create policy "organizers remove hangout members" on public.hangout_members for delete to authenticated
using (exists (
  select 1 from public.hangouts h
  where h.id = hangout_members.hangout_id and public.is_group_organizer(h.group_id, (select auth.uid()))
));

create policy "group members read quests" on public.quests for select to authenticated
using (exists (
  select 1 from public.hangouts h
  where h.id = quests.hangout_id and public.is_group_member(h.group_id, (select auth.uid()))
));
create policy "organizers manage quests" on public.quests for insert to authenticated
with check (exists (
  select 1 from public.hangouts h
  where h.id = quests.hangout_id and public.is_group_organizer(h.group_id, (select auth.uid()))
));
create policy "users manage own quest completion" on public.quest_completions for all to authenticated
using (user_id = (select auth.uid()) and exists (
  select 1 from public.quests q join public.hangouts h on h.id = q.hangout_id
  where q.id = quest_completions.quest_id and public.is_group_member(h.group_id, (select auth.uid()))
)) with check (user_id = (select auth.uid()) and exists (
  select 1 from public.quests q join public.hangouts h on h.id = q.hangout_id
  where q.id = quest_completions.quest_id and public.is_group_member(h.group_id, (select auth.uid()))
));
create policy "users read own notifications" on public.notifications for select to authenticated
using (user_id = (select auth.uid()));
create policy "users update own notifications" on public.notifications for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "users manage their blocks" on public.blocked_users for all to authenticated
using (blocker_id = (select auth.uid())) with check (blocker_id = (select auth.uid()));
create policy "users manage own push tokens" on public.push_tokens for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- OAuth replay nonces are server-managed; no anon/authenticated policy is granted.
revoke all on public.calendar_provider_tokens, public.oauth_state_nonces from anon, authenticated;
grant all on public.calendar_provider_tokens, public.oauth_state_nonces to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('hangout-media', 'hangout-media', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "group members read private hangout media" on storage.objects for select to authenticated
using (bucket_id = 'hangout-media' and exists (
  select 1 from public.hangouts h
  where h.id::text = (storage.foldername(name))[1] and public.is_group_member(h.group_id, (select auth.uid()))
));
create policy "members upload own private hangout media" on storage.objects for insert to authenticated
with check (bucket_id = 'hangout-media' and (storage.foldername(name))[2] = (select auth.uid())::text and exists (
  select 1 from public.hangouts h
  where h.id::text = (storage.foldername(name))[1] and public.is_group_member(h.group_id, (select auth.uid()))
));
create policy "users delete own private hangout media" on storage.objects for delete to authenticated
using (bucket_id = 'hangout-media' and (storage.foldername(name))[2] = (select auth.uid())::text);
