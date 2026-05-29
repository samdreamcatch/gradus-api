-- Drop existing check constraints
ALTER TABLE public.moves DROP CONSTRAINT moves_default_target_kind_check;
ALTER TABLE public.plan_moves DROP CONSTRAINT plan_moves_target_kind_check;

-- Update data
UPDATE public.moves SET default_target_kind = 'mins' WHERE default_target_kind = 'minutes';
UPDATE public.plan_moves SET target_kind = 'mins' WHERE target_kind = 'minutes';

-- Add new check constraints
ALTER TABLE public.moves ADD CONSTRAINT moves_default_target_kind_check CHECK (default_target_kind = ANY (ARRAY['reps'::text, 'mins'::text]));
ALTER TABLE public.plan_moves ADD CONSTRAINT plan_moves_target_kind_check CHECK (target_kind = ANY (ARRAY['reps'::text, 'mins'::text]));

-- Update seed_moves if it exists
DO $$ 
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'seed_moves') THEN
        ALTER TABLE public.seed_moves DROP CONSTRAINT IF EXISTS seed_moves_default_target_kind_check;
        UPDATE public.seed_moves SET default_target_kind = 'mins' WHERE default_target_kind = 'minutes';
        ALTER TABLE public.seed_moves ADD CONSTRAINT seed_moves_default_target_kind_check CHECK (default_target_kind = ANY (ARRAY['reps'::text, 'mins'::text]));
    END IF;
END $$;
