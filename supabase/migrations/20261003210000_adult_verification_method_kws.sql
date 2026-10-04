-- Decision #38 (Mariah, 2026-10-03): every verification method KWS offers is
-- on in production. In the United States that is credit card, debit card and
-- the Social Security number check (last four digits); ID scan and face scan
-- are not offered there. KWS reports no method in the `parent-verified`
-- webhook or the Verification Response, so the stored method names the
-- provider, not the instrument: `kws` replaces `kws_card`.
--
-- EXPAND step only (review 2026-10-04). A Lovable publish and a migration
-- are separate steps, so in either order one of them would run against the
-- other's constraint: new code writing `kws` into the old CHECK, or old code
-- writing `kws_card` into a tightened one, each turning a KWS webhook into a
-- 500 and a lost verification. Widening the CHECK first lets both values in;
-- the server normalizes `kws_card` to `kws` on read
-- (`normalizeAdultVerificationMethod`). Apply this BEFORE the publish that
-- carries web PR #176. The CONTRACT step (relabel `kws_card` → `kws` on
-- parent_profiles and in guardian_consents.evidence, then tighten the CHECK
-- to kws | admin | legacy) is a separate migration in a later PR, applied
-- once the publish is live.

ALTER TABLE public.parent_profiles
  DROP CONSTRAINT IF EXISTS parent_profiles_adult_verification_method_check;

ALTER TABLE public.parent_profiles
  ADD CONSTRAINT parent_profiles_adult_verification_method_check
  CHECK (
    adult_verification_method IS NULL
    OR adult_verification_method IN ('kws_card', 'kws', 'admin', 'legacy')
  );
