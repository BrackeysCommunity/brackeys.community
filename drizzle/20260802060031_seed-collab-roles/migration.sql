-- Seed the collab role catalogue. Categories group the picker; art is
-- deliberately fine-grained since "artist" spans very different crafts.
-- Idempotent on name so re-running (or a later re-seed) never duplicates.
INSERT INTO "collab"."collab_roles" ("name", "category") VALUES
  -- Programming
  ('Gameplay Programmer', 'Programming'),
  ('Engine Programmer', 'Programming'),
  ('UI Programmer', 'Programming'),
  ('Tools Programmer', 'Programming'),
  ('Network Programmer', 'Programming'),
  ('Graphics Programmer', 'Programming'),
  ('Generalist Programmer', 'Programming'),
  -- Art
  ('2D Artist', 'Art'),
  ('Pixel Artist', 'Art'),
  ('Concept Artist', 'Art'),
  ('3D Modeler', 'Art'),
  ('Character Artist', 'Art'),
  ('Environment Artist', 'Art'),
  ('Animator', 'Art'),
  ('VFX Artist', 'Art'),
  ('Technical Artist', 'Art'),
  ('UI Artist', 'Art'),
  -- Audio
  ('Composer', 'Audio'),
  ('Sound Designer', 'Audio'),
  ('Voice Actor', 'Audio'),
  -- Design
  ('Game Designer', 'Design'),
  ('Level Designer', 'Design'),
  ('Systems Designer', 'Design'),
  ('Narrative Designer', 'Design'),
  ('UX Designer', 'Design'),
  -- Writing
  ('Writer', 'Writing'),
  ('Editor', 'Writing'),
  ('Localization', 'Writing'),
  -- Production
  ('Producer', 'Production'),
  ('Project Manager', 'Production'),
  -- Marketing & Community
  ('Marketer', 'Marketing & Community'),
  ('Community Manager', 'Marketing & Community'),
  ('Social Media Manager', 'Marketing & Community'),
  -- QA
  ('QA Tester', 'QA'),
  ('Playtester', 'QA')
ON CONFLICT ("name") DO NOTHING;
