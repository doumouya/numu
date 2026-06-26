-- 0008_cases_guard.sql — G4.2: the DB backstop for the close gate. A status change INTO the terminal state
-- is refused (custom sqlstate NU001 → mapped to 422 close_preconditions_unmet in error.rs) unless every
-- workflow close_check has a passed=true case_close_checks row. The Rust layer (objects.rs) checks this
-- first for a clean error; this trigger guarantees the invariant even on a direct DB write — "the gate is a
-- query, not a prompt". (docs/OBJECTS.md G4, CASE 0006.)
create or replace function cases_guard() returns trigger as $$
declare
  wf       record;
  terminal text;
  unmet    int;
begin
  if new.status is distinct from old.status then
    select states, close_checks into wf from workflows where workflow_id = new.workflow_id;
    if wf.states is null then
      raise exception 'unknown workflow %', new.workflow_id using errcode = 'NU001';
    end if;
    terminal := wf.states ->> (jsonb_array_length(wf.states) - 1);
    if new.status = terminal then
      select count(*) into unmet
      from jsonb_array_elements_text(wf.close_checks) as c(name)
      where not exists (
        select 1 from case_close_checks cc
        where cc.case_id = new.entity_id and cc.check_name = c.name and cc.passed
      );
      if unmet > 0 then
        raise exception 'close preconditions unmet for %', new.entity_id using errcode = 'NU001';
      end if;
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger cases_guard before update on cases
  for each row execute function cases_guard();
