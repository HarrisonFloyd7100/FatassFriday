-- Run once in a NEW Supabase project's SQL Editor. Safe to re-run for this app.
-- No passwords, private keys, or emails are stored in the public tournament.
begin;
create schema if not exists ladder_private;
revoke all on schema ladder_private from public, anon, authenticated;
create table if not exists ladder_private.editors (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table if not exists ladder_private.requests (
  id uuid primary key,
  created_at timestamptz not null default now()
);
create table if not exists ladder_private.checkpoints (
  round integer primary key,
  state jsonb not null,
  created_at timestamptz not null default now()
);
revoke all on all tables in schema ladder_private from public, anon, authenticated;

create table if not exists public.ladder_board (
  id integer primary key check (id = 1),
  state jsonb not null
);
insert into public.ladder_board(id,state) values
  (1,'{"version":0,"round":1,"roundLabel":1,"canRollback":false,"players":{},"cards":[],"results":{},"skipped":{}}'::jsonb)
on conflict(id) do nothing;
-- Upgrade existing boards without resetting players, scores, placements, or history.
update public.ladder_board set state = jsonb_set(state || '{"skipped":{}}'::jsonb,
  '{version}',to_jsonb((state->>'version')::integer+1)) where not state ? 'skipped';
update public.ladder_board set state = jsonb_set(state || jsonb_build_object('roundLabel',state->'round','canRollback',exists(select 1 from ladder_private.checkpoints)),
  '{version}',to_jsonb((state->>'version')::integer+1)) where not state ? 'roundLabel';
create table if not exists public.ladder_matches (
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in ('card','extra')),
  round integer not null check(round > 0),
  card integer,
  winner_id text not null,
  loser_id text not null,
  played_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(winner_id <> loser_id),
  check((kind='card' and card is not null and card>=0) or (kind='extra' and card is null))
);
alter table public.ladder_matches add column if not exists round_label integer;
update public.ladder_matches set round_label=round where round_label is null;
alter table public.ladder_matches alter column round_label set not null;
alter table public.ladder_matches add column if not exists ignored boolean not null default false;
alter table public.ladder_matches add column if not exists note text not null default '';
create unique index if not exists ladder_one_card_result on public.ladder_matches(round,card) where kind='card';
create index if not exists ladder_match_time on public.ladder_matches(played_at desc,id desc);
create index if not exists ladder_match_winner on public.ladder_matches(winner_id);
create index if not exists ladder_match_loser on public.ladder_matches(loser_id);
alter table public.ladder_board enable row level security;
alter table public.ladder_matches enable row level security;
revoke all on public.ladder_board, public.ladder_matches from public, anon, authenticated;
grant select on public.ladder_board, public.ladder_matches to anon, authenticated;
drop policy if exists ladder_public_board on public.ladder_board;
create policy ladder_public_board on public.ladder_board for select to anon,authenticated using(true);
drop policy if exists ladder_public_matches on public.ladder_matches;
create policy ladder_public_matches on public.ladder_matches for select to anon,authenticated using(true);

create or replace function public.ladder_is_editor() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(
    select 1 from ladder_private.editors where user_id=auth.uid()
  );
$$;
revoke all on function public.ladder_is_editor() from public,anon;
grant execute on function public.ladder_is_editor() to authenticated;

create or replace function public.ladder_match_count() returns bigint
language sql stable security invoker set search_path = '' as $$
  select count(*) from public.ladder_matches;
$$;
revoke all on function public.ladder_match_count() from public;
grant execute on function public.ladder_match_count() to anon,authenticated;

-- Single, serialized, authorized mutation entry point. Clients never write state directly.
create or replace function public.ladder_action(
  p_action text, p_payload jsonb, p_version integer, p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s jsonb; cards jsonb; results jsonb; players jsonb; skipped jsonb; original_cards jsonb; desired jsonb;
  c jsonb; next_cards jsonb; bucket jsonb; adjustments jsonb := '[]'::jsonb; adj jsonb;
  n integer; i integer; j integer; k integer; target integer; source_card integer; source_seat integer; round_num integer; round_label_num integer; card_num integer; checkpoint_round integer; restored_state jsonb; affected integer[] := array[]::integer[]; displaced text;
  winner text; loser text; previous_winner text; new_id text; player_name text;
  old_match public.ladder_matches%rowtype; checkpoint_rec record; checkpoint_state jsonb; new_ignored boolean; match_note text;
  had_old boolean; has_pair boolean := false;
begin
  if not public.ladder_is_editor() then
    raise exception 'Organizer access required.' using errcode='42501';
  end if;
  if p_action is null or p_payload is null or p_version is null or p_request_id is null then
    raise exception 'Missing request fields.';
  end if;
  select state into s from public.ladder_board where id=1 for update;
  if s is null then raise exception 'Tournament not initialized.'; end if;
  -- Idempotent replay: a lost response cannot apply the same request twice.
  if exists(select 1 from ladder_private.requests where id=p_request_id) then return s; end if;
  if (s->>'version')::integer <> p_version then
    raise exception 'The board changed. Refresh and review it before trying again.' using errcode='40001';
  end if;
  cards := s->'cards'; results := s->'results'; players := s->'players'; skipped := coalesce(s->'skipped','{}'::jsonb);
  round_num := (s->>'round')::integer; round_label_num := coalesce((s->>'roundLabel')::integer,round_num); n := jsonb_array_length(cards);

  if p_payload ? 'note' then
    if jsonb_typeof(p_payload->'note') not in ('string','null') then raise exception 'Use a text note of up to 10,000 characters.'; end if;
    match_note:=coalesce(p_payload->>'note','');
    if char_length(match_note)>10000 then raise exception 'Use a text note of up to 10,000 characters.'; end if;
  end if;
  if p_action = 'history_note' then
    update public.ladder_matches set note=coalesce(match_note,''),updated_at=clock_timestamp() where id=(p_payload->>'match')::uuid;
    if not found then raise exception 'Match not found. Refresh history and try again.'; end if;

  elsif p_action in ('history_edit','history_delete','history_ignore') then
    select * into old_match from public.ladder_matches where id=(p_payload->>'match')::uuid;
    if not found then raise exception 'Match not found. Refresh history and try again.'; end if;
    winner:=old_match.winner_id; loser:=old_match.loser_id; new_ignored:=old_match.ignored;
    if p_action='history_edit' then
      winner:=p_payload->>'winner';
      if winner is null or winner not in (old_match.winner_id,old_match.loser_id) then
        raise exception 'Choose one of the original two players as winner.';
      end if;
      loser:=case when winner=old_match.winner_id then old_match.loser_id else old_match.winner_id end;
    elsif p_action='history_ignore' then
      if jsonb_typeof(p_payload->'ignored') is distinct from 'boolean' then raise exception 'Choose whether the match should count.'; end if;
      new_ignored:=(p_payload->>'ignored')::boolean;
    end if;
    if not old_match.ignored then
      adjustments:=adjustments || jsonb_build_array(jsonb_build_array(old_match.winner_id,'wins',-1),jsonb_build_array(old_match.loser_id,'losses',-1));
    end if;
    if p_action='history_delete' then
      delete from public.ladder_matches where id=old_match.id;
      if old_match.kind='card' and old_match.round=round_num then results:=results-old_match.card::text; end if;
    else
      update public.ladder_matches set winner_id=winner,loser_id=loser,ignored=new_ignored,updated_at=clock_timestamp() where id=old_match.id;
      if not new_ignored then adjustments:=adjustments || jsonb_build_array(jsonb_build_array(winner,'wins',1),jsonb_build_array(loser,'losses',1)); end if;
      if old_match.kind='card' and old_match.round=round_num then results:=jsonb_set(results,array[old_match.card::text],to_jsonb(winner)); end if;
    end if;
    -- Apply permanent history corrections to every checkpoint that included this match.
    for checkpoint_rec in select round,state from ladder_private.checkpoints where round>=old_match.round for update loop
      checkpoint_state:=checkpoint_rec.state;
      for adj in select value from jsonb_array_elements(adjustments) loop
        checkpoint_state:=jsonb_set(checkpoint_state,array['players',adj->>0,adj->>1],to_jsonb((checkpoint_state #>> array['players',adj->>0,adj->>1])::integer+(adj->>2)::integer));
      end loop;
      if old_match.kind='card' and checkpoint_rec.round=old_match.round then
        if p_action='history_delete' then checkpoint_state:=jsonb_set(checkpoint_state,'{results}',(checkpoint_state->'results')-old_match.card::text);
        else checkpoint_state:=jsonb_set(checkpoint_state,array['results',old_match.card::text],to_jsonb(winner)); end if;
      end if;
      update ladder_private.checkpoints set state=checkpoint_state where round=checkpoint_rec.round;
    end loop;

  elsif p_action = 'rename_player' then
    new_id := p_payload->>'player'; player_name := btrim(p_payload->>'name');
    if new_id is null or not players ? new_id then raise exception 'Player not found.'; end if;
    if player_name is null or char_length(player_name) not between 1 and 40 then raise exception 'Use a player name between 1 and 40 characters.'; end if;
    if exists(select 1 from jsonb_each(players) p where p.key<>new_id and lower(p.value->>'name')=lower(player_name)) then
      raise exception 'That name is already in the tournament.';
    end if;
    players := jsonb_set(players,array[new_id,'name'],to_jsonb(player_name));

  elsif p_action = 'add' then
    player_name := btrim(p_payload->>'name');
    if player_name is null or char_length(player_name) not between 1 and 40 then
      raise exception 'Use a player name between 1 and 40 characters.';
    end if;
    select p.key into new_id from jsonb_each(players) p where lower(p.value->>'name')=lower(player_name);
    if new_id is not null then
      if exists(select 1 from jsonb_array_elements(cards) c where c.value ? new_id) then
        raise exception 'That name is already in the tournament.';
      end if;
      -- Re-adding an off-ladder player restores their identity and earlier record.
    else
      new_id := gen_random_uuid()::text;
      players := players || jsonb_build_object(new_id,jsonb_build_object('id',new_id,'name',player_name,'wins',0,'losses',0));
    end if;
    if n>0 and jsonb_array_length(cards->(n-1))=1 then
      skipped := skipped - (n-1)::text;
      cards := jsonb_set(cards,array[(n-1)::text],(cards->(n-1)) || jsonb_build_array(new_id));
    else cards := cards || jsonb_build_array(jsonb_build_array(new_id)); end if;

  elsif p_action = 'result' then
    card_num := (p_payload->>'card')::integer; winner := p_payload->>'winner';
    if card_num is null or card_num<0 or card_num>=n or winner is null then raise exception 'Invalid card result.'; end if;
    c := cards->card_num;
    if skipped ? card_num::text then raise exception 'Restore this skipped card before recording a winner.'; end if;
    if jsonb_array_length(c)<>2 or not c ? winner then raise exception 'Invalid card result.'; end if;
    previous_winner := results->>card_num::text;
    if previous_winner = winner and not p_payload ? 'note' then
      insert into ladder_private.requests(id) values(p_request_id);
      return s;
    end if;
    if previous_winner is distinct from winner or p_payload ? 'note' then
      loser := case when c->>0=winner then c->>1 else c->>0 end;
      select * into old_match from public.ladder_matches where kind='card' and round=round_num and card=card_num;
      had_old := found;
      if had_old then
        if not old_match.ignored then
        adjustments := adjustments || jsonb_build_array(
          jsonb_build_array(old_match.winner_id,'wins',-1),jsonb_build_array(old_match.loser_id,'losses',-1));
        end if;
        update public.ladder_matches set winner_id=winner,loser_id=loser,note=case when p_payload ? 'note' then match_note else old_match.note end,updated_at=clock_timestamp() where id=old_match.id;
      else
        insert into public.ladder_matches(kind,round,round_label,card,winner_id,loser_id,note) values('card',round_num,round_label_num,card_num,winner,loser,coalesce(match_note,''));
      end if;
      if not had_old or not old_match.ignored then
        adjustments := adjustments || jsonb_build_array(jsonb_build_array(winner,'wins',1),jsonb_build_array(loser,'losses',1));
      end if;
      results := jsonb_set(results,array[card_num::text],to_jsonb(winner));
    end if;

  elsif p_action in ('clear_result','skip','unskip','delete_card','edit_card') then
    card_num := (p_payload->>'card')::integer;
    if card_num is null or card_num<0 or card_num>=n then raise exception 'Invalid card.'; end if;
    c := cards->card_num;
    if p_action='unskip' then
      skipped := skipped - card_num::text;
    elsif p_action='edit_card' then
      desired := p_payload->'players';
      if desired is null or jsonb_typeof(desired)<>'array' then raise exception 'Choose different active players for each seat.'; end if;
      if jsonb_array_length(desired)<>jsonb_array_length(c)
        or (select count(distinct value) from jsonb_array_elements_text(desired))<>jsonb_array_length(desired) then
        raise exception 'Choose different active players for each seat.';
      end if;
      for i in 0..jsonb_array_length(desired)-1 loop
        if not exists(select 1 from jsonb_array_elements(cards) x where x.value ? (desired->>i)) then
          raise exception 'Choose different active players for each seat.';
        end if;
      end loop;
      original_cards := cards;
      for j in 0..jsonb_array_length(desired)-1 loop
        winner := desired->>j;
        for i in 0..n-1 loop
          for k in 0..jsonb_array_length(cards->i)-1 loop
            if cards->i->>k=winner then source_card:=i; source_seat:=k; end if;
          end loop;
        end loop;
        displaced := cards->card_num->>j;
        cards := jsonb_set(cards,array[source_card::text,source_seat::text],to_jsonb(displaced));
        cards := jsonb_set(cards,array[card_num::text,j::text],to_jsonb(winner));
      end loop;
      for i in 0..n-1 loop
        if cards->i is distinct from original_cards->i then affected := array_append(affected,i); end if;
      end loop;
    else
      if p_action='skip' and jsonb_array_length(c)<>2 then raise exception 'Solo cards already have a bye.'; end if;
      affected := array[card_num];
    end if;

  elsif p_action = 'extra' then
    winner := p_payload->>'winner'; loser := p_payload->>'loser';
    if winner is null or loser is null or winner=loser or not players ? winner or not players ? loser then
      raise exception 'Choose two different players in this tournament.';
    end if;
    adjustments := jsonb_build_array(jsonb_build_array(winner,'wins',1),jsonb_build_array(loser,'losses',1));
    insert into public.ladder_matches(kind,round,round_label,winner_id,loser_id,note) values('extra',round_num,round_label_num,winner,loser,coalesce(match_note,''));

  elsif p_action = 'set_round_number' then
    if jsonb_typeof(p_payload->'number') is distinct from 'number' then raise exception 'Use a round number from 1 to 1,000,000.'; end if;
    if (p_payload->>'number')::numeric <> trunc((p_payload->>'number')::numeric)
      or (p_payload->>'number')::numeric not between 1 and 1000000 then
      raise exception 'Use a round number from 1 to 1,000,000.';
    end if;
    round_label_num := (p_payload->>'number')::integer;
    update public.ladder_matches set round_label=round_label_num where round=round_num;

  elsif p_action = 'clear_round' then
    for i in 0..n-1 loop affected := array_append(affected,i); end loop;

  elsif p_action = 'rollback' then
    select round,state into checkpoint_round,restored_state from ladder_private.checkpoints order by round desc limit 1;
    if restored_state is null then
      raise exception 'No saved round is available to roll back. Checkpoints start with the next round you advance.';
    end if;
    delete from public.ladder_matches where round>checkpoint_round;
    delete from ladder_private.checkpoints where round=checkpoint_round;
    players := restored_state->'players'; cards := restored_state->'cards';
    results := restored_state->'results'; skipped := coalesce(restored_state->'skipped','{}'::jsonb);
    round_num := (restored_state->>'round')::integer;
    round_label_num := coalesce((restored_state->>'roundLabel')::integer,round_num);

  elsif p_action = 'advance' then
    next_cards := '[]'::jsonb;
    for i in 0..n-1 loop next_cards := next_cards || '[[]]'::jsonb; end loop;
    for i in 0..n-1 loop
      c := cards->i;
      if jsonb_array_length(c)=2 then has_pair:=true; end if;
      if skipped ? i::text then
        next_cards := jsonb_set(next_cards,array[i::text],c);
        continue;
      end if;
      if jsonb_array_length(c)=2 then
        has_pair := true; winner := results->>i::text;
        if winner is null or not c ? winner then raise exception 'Pick a winner or skip every paired card first.'; end if;
      else winner := c->>0; end if;
      target := case when i=0 or skipped ? (i-1)::text then i else i-1 end;
      bucket := (next_cards->target) || jsonb_build_array(winner);
      next_cards := jsonb_set(next_cards,array[target::text],bucket);
      if jsonb_array_length(c)=2 then
        loser := case when c->>0=winner then c->>1 else c->>0 end;
        target := case when i=n-1 or skipped ? (i+1)::text then i else i+1 end;
        bucket := (next_cards->target) || jsonb_build_array(loser);
        next_cards := jsonb_set(next_cards,array[target::text],bucket);
      end if;
    end loop;
    if not has_pair then raise exception 'Add at least two players before advancing.'; end if;
    insert into ladder_private.checkpoints(round,state) values(round_num,s);
    cards := next_cards; results := '{}'::jsonb; skipped := '{}'::jsonb; round_num := round_num+1; round_label_num := round_label_num+1;
  else raise exception 'Unknown action.'; end if;

  -- Clear invalidated CURRENT-round results only; reverse exactly their scores.
  foreach i in array affected loop
    select * into old_match from public.ladder_matches where kind='card' and round=round_num and card=i;
    if found then
      if not old_match.ignored then
      adjustments := adjustments || jsonb_build_array(
        jsonb_build_array(old_match.winner_id,'wins',-1),jsonb_build_array(old_match.loser_id,'losses',-1));
      end if;
      delete from public.ladder_matches where id=old_match.id;
    end if;
    results := results - i::text; skipped := skipped - i::text;
  end loop;
  if p_action='skip' then skipped := skipped || jsonb_build_object(card_num::text,true); end if;
  if p_action='delete_card' then
    cards := cards - card_num;
    -- Shift later card numbers in ascending order to preserve the unique match index.
    for i in card_num+1..n-1 loop
      if results ? i::text then results := (results - i::text) || jsonb_build_object((i-1)::text,results->i::text); end if;
      if skipped ? i::text then skipped := (skipped - i::text) || jsonb_build_object((i-1)::text,true); end if;
      update public.ladder_matches set card=i-1 where kind='card' and round=round_num and card=i;
    end loop;
  end if;

  for adj in select value from jsonb_array_elements(adjustments) loop
    players := jsonb_set(players,array[adj->>0,adj->>1],to_jsonb((players #>> array[adj->>0,adj->>1])::integer+(adj->>2)::integer));
  end loop;
  s := jsonb_build_object('players',players,'cards',cards,'results',results,'skipped',skipped,'round',round_num,'roundLabel',round_label_num,'canRollback',exists(select 1 from ladder_private.checkpoints),'version',p_version+1);
  update public.ladder_board set state=s where id=1;
  insert into ladder_private.requests(id) values(p_request_id);
  return s;
end;
$$;
revoke all on function public.ladder_action(text,jsonb,integer,uuid) from public,anon;
grant execute on function public.ladder_action(text,jsonb,integer,uuid) to authenticated;
notify pgrst, 'reload schema';
commit;

-- NEXT: Create an organizer in Authentication > Users (email + password).
-- Then paste that user's actual UUID into this separate statement and run it:
-- insert into ladder_private.editors(user_id) values ('PASTE-USER-UUID-HERE'::uuid)
-- on conflict do nothing;
