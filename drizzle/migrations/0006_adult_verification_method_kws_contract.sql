-- CONTRACT step of the `kws_card` -> `kws` relabel (decision #38, Mariah
-- 2026-10-03; the expand step is 20261003210000, shipped with web PR #176).
--
-- DO NOT APPLY until production runs web PR #176's code (the Lovable Publish
-- that carries it). Until then the published server still WRITES `kws_card`,
-- and the tightened CHECK below would turn every KWS webhook into a failed
-- verification. Once the publish is live nothing writes `kws_card` any more:
--   1. relabel what is already stored, on the parent profile and in the
--      consent ledger's evidence;
--   2. tighten the CHECK to the three values that remain.
-- The server's read-side normalization (`normalizeAdultVerificationMethod`)
-- becomes dead code after this and can be removed in a later cleanup.

UPDATE public.parent_profiles
SET adult_verification_method = 'kws'
WHERE adult_verification_method = 'kws_card';

-- The ledger records which verification backed a consent: `evidence.verification`.
UPDATE public.guardian_consents
SET evidence = jsonb_set(evidence, '{verification}', '"kws"'::jsonb)
WHERE evidence ->> 'verification' = 'kws_card';

ALTER TABLE public.parent_profiles
  DROP CONSTRAINT IF EXISTS parent_profiles_adult_verification_method_check;

ALTER TABLE public.parent_profiles
  ADD CONSTRAINT parent_profiles_adult_verification_method_check
  CHECK (
    adult_verification_method IS NULL
    OR adult_verification_method IN ('kws', 'admin', 'legacy')
  );
