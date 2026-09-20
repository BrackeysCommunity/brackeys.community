-- A notification snapshots its subject's URL at send time, and a profile
-- wall's URL used to be the member's vanity stub. Changing a handle broke
-- every notification pointing at that wall, and nothing can resolve the
-- retired stub — `profile_url_stubs` holds one row per member, not a
-- history. New rows carry the profile id instead (see
-- `src/lib/comment-subjects.ts`); this repoints the rows already written,
-- resolving them through the thread each one names rather than through the
-- dead handle in the URL. Rows already pointing at the right place are
-- left alone.
WITH target AS (
  SELECT
    n.id AS notification_id,
    '/profile/' || t.profile_user_id
      || coalesce(substring(n.data ->> 'subjectUrl' FROM '#.*$'), '') AS url
  FROM "user".notifications n
  -- Comment fan-out names the thread; moderation and report outcomes name
  -- the comment, one hop further out.
  LEFT JOIN social.comments c
    ON n.entity_type = 'comment' AND c.id::text = n.entity_id
  JOIN social.threads t
    ON t.id = CASE WHEN n.entity_type = 'thread' THEN n.entity_id::bigint ELSE c.thread_id END
  WHERE n.data ->> 'subjectUrl' LIKE '/profile/%'
    AND t.profile_user_id IS NOT NULL
)
UPDATE "user".notifications n
SET data = jsonb_set(n.data, '{subjectUrl}', to_jsonb(target.url))
FROM target
WHERE n.id = target.notification_id
  AND n.data ->> 'subjectUrl' IS DISTINCT FROM target.url;
