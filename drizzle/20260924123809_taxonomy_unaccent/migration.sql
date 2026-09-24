-- Accent-insensitive search. `unaccent()` itself is only STABLE (its
-- dictionary could change), so it can't back an index or be inlined; the
-- wrapper pins the dictionary and is declared IMMUTABLE, the usual recipe.
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;
