-- Companion to 20260919233628_notification_profile_url_ids, for the last
-- place a mutable handle was frozen into a notification row. Team report
-- outcomes stored `/teams/<slug>` as their subject URL, and an owner
-- renaming the team (setTeamSlug) stranded every one of them.
--
-- The rest of the team notifications need no repair: they have carried
-- `data->>'teamId'` since teams shipped, and the inbox now builds their
-- links from that id rather than the slug beside it. Only this snapshot
-- URL had no id to fall back on — it is resolved here through the team the
-- row already names in `entity_id`.
UPDATE "user".notifications n
SET data = jsonb_set(n.data, '{subjectUrl}', to_jsonb('/teams/' || t.id))
FROM team.teams t
WHERE n.entity_type = 'team'
  AND t.id = n.entity_id
  AND n.data ->> 'subjectUrl' LIKE '/teams/%'
  AND n.data ->> 'subjectUrl' IS DISTINCT FROM '/teams/' || t.id;
