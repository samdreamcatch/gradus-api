export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_allowlist: {
        Row: {
          created_at: string
          email: string
        }
        Insert: {
          created_at?: string
          email: string
        }
        Update: {
          created_at?: string
          email?: string
        }
        Relationships: []
      }
      adult_athlete_invite_codes: {
        Row: {
          athlete_id: string
          code: string
          created_at: string
          id: string
          promo_code: string | null
        }
        Insert: {
          athlete_id: string
          code: string
          created_at?: string
          id?: string
          promo_code?: string | null
        }
        Update: {
          athlete_id?: string
          code?: string
          created_at?: string
          id?: string
          promo_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "adult_athlete_invite_codes_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: true
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adult_athlete_invite_codes_promo_code_fkey"
            columns: ["promo_code"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["code"]
          },
        ]
      }
      api_idempotency_keys: {
        Row: {
          created_at: string
          key: string
          request_hash: string | null
          response_body: Json | null
          response_status: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          key: string
          request_hash?: string | null
          response_body?: Json | null
          response_status?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          key?: string
          request_hash?: string | null
          response_body?: Json | null
          response_status?: number | null
          user_id?: string
        }
        Relationships: []
      }
      api_rate_limits: {
        Row: {
          bucket: string
          count: number
          window_start: string
        }
        Insert: {
          bucket: string
          count?: number
          window_start: string
        }
        Update: {
          bucket?: string
          count?: number
          window_start?: string
        }
        Relationships: []
      }
      app_attest_keys: {
        Row: {
          bundle_id: string
          created_at: string
          environment: string
          id: string
          key_id: string
          public_key: string
          revoked_at: string | null
          sign_count: number
          team_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          bundle_id: string
          created_at?: string
          environment: string
          id?: string
          key_id: string
          public_key: string
          revoked_at?: string | null
          sign_count?: number
          team_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          bundle_id?: string
          created_at?: string
          environment?: string
          id?: string
          key_id?: string
          public_key?: string
          revoked_at?: string | null
          sign_count?: number
          team_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      athlete_coach_visibility: {
        Row: {
          athlete_id: string
          coach_id: string
          created_at: string
          enabled_by_parent_id: string | null
          id: string
        }
        Insert: {
          athlete_id: string
          coach_id: string
          created_at?: string
          enabled_by_parent_id?: string | null
          id?: string
        }
        Update: {
          athlete_id?: string
          coach_id?: string
          created_at?: string
          enabled_by_parent_id?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "athlete_coach_visibility_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "athlete_coach_visibility_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "athlete_coach_visibility_enabled_by_parent_id_fkey"
            columns: ["enabled_by_parent_id"]
            isOneToOne: false
            referencedRelation: "parent_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_competition_results: {
        Row: {
          athlete_id: string
          competition_id: string
          created_at: string
          event_file: string
          event_name: string
          id: string
          placement: string
          protocol: Json | null
          rink: string
          segment: string
          segment_score: string
          skated_on: string | null
          start_order: number | null
          total_score: string
          updated_at: string
        }
        Insert: {
          athlete_id: string
          competition_id: string
          created_at?: string
          event_file?: string
          event_name: string
          id?: string
          placement?: string
          protocol?: Json | null
          rink?: string
          segment?: string
          segment_score?: string
          skated_on?: string | null
          start_order?: number | null
          total_score?: string
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          competition_id?: string
          created_at?: string
          event_file?: string
          event_name?: string
          id?: string
          placement?: string
          protocol?: Json | null
          rink?: string
          segment?: string
          segment_score?: string
          skated_on?: string | null
          start_order?: number | null
          total_score?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "athlete_competition_results_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "athlete_competition_results_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_competition_skaters: {
        Row: {
          athlete_id: string
          club: string
          competition_id: string
          created_at: string
          id: string
          ijs_key: string | null
          linked_by: string | null
          skater_name: string
        }
        Insert: {
          athlete_id: string
          club?: string
          competition_id: string
          created_at?: string
          id?: string
          ijs_key?: string | null
          linked_by?: string | null
          skater_name: string
        }
        Update: {
          athlete_id?: string
          club?: string
          competition_id?: string
          created_at?: string
          id?: string
          ijs_key?: string | null
          linked_by?: string | null
          skater_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "athlete_competition_skaters_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "athlete_competition_skaters_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_goals: {
        Row: {
          athlete_id: string
          coach_id: string | null
          created_at: string
          current_level_key: string
          id: string
          long_term_goal: string
          season_goal_key: string
          sport: string
          updated_at: string
        }
        Insert: {
          athlete_id: string
          coach_id?: string | null
          created_at?: string
          current_level_key: string
          id?: string
          long_term_goal?: string
          season_goal_key: string
          sport: string
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          coach_id?: string | null
          created_at?: string
          current_level_key?: string
          id?: string
          long_term_goal?: string
          season_goal_key?: string
          sport?: string
          updated_at?: string
        }
        Relationships: []
      }
      athlete_goals_history: {
        Row: {
          athlete_id: string
          changed_by_role: string
          changed_by_user_id: string | null
          created_at: string
          current_level_key: string
          id: string
          long_term_goal: string
          previous_current_level_key: string | null
          previous_long_term_goal: string | null
          previous_season_goal_key: string | null
          season_goal_key: string
          sport: string
        }
        Insert: {
          athlete_id: string
          changed_by_role: string
          changed_by_user_id?: string | null
          created_at?: string
          current_level_key: string
          id?: string
          long_term_goal?: string
          previous_current_level_key?: string | null
          previous_long_term_goal?: string | null
          previous_season_goal_key?: string | null
          season_goal_key: string
          sport: string
        }
        Update: {
          athlete_id?: string
          changed_by_role?: string
          changed_by_user_id?: string | null
          created_at?: string
          current_level_key?: string
          id?: string
          long_term_goal?: string
          previous_current_level_key?: string | null
          previous_long_term_goal?: string | null
          previous_season_goal_key?: string | null
          season_goal_key?: string
          sport?: string
        }
        Relationships: [
          {
            foreignKeyName: "athlete_goals_history_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_guardians: {
        Row: {
          athlete_id: string
          created_at: string
          id: string
          parent_id: string
          role: string
        }
        Insert: {
          athlete_id: string
          created_at?: string
          id?: string
          parent_id: string
          role?: string
        }
        Update: {
          athlete_id?: string
          created_at?: string
          id?: string
          parent_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "athlete_guardians_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "athlete_guardians_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "parent_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_invite_codes: {
        Row: {
          athlete_id: string
          claimed_at: string | null
          claimed_by: string | null
          code: string
          created_at: string
          expires_at: string | null
          id: string
          parent_id: string
          promo_code: string | null
          updated_at: string
          used_at: string | null
        }
        Insert: {
          athlete_id: string
          claimed_at?: string | null
          claimed_by?: string | null
          code: string
          created_at?: string
          expires_at?: string | null
          id?: string
          parent_id: string
          promo_code?: string | null
          updated_at?: string
          used_at?: string | null
        }
        Update: {
          athlete_id?: string
          claimed_at?: string | null
          claimed_by?: string | null
          code?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          parent_id?: string
          promo_code?: string | null
          updated_at?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "athlete_invite_codes_promo_code_fkey"
            columns: ["promo_code"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["code"]
          },
        ]
      }
      athlete_lesson_slots: {
        Row: {
          athlete_id: string
          coach_id: string | null
          created_at: string
          day_of_week: number
          end_minute: number
          frequency: string
          id: string
          start_minute: number
          starts_on: string | null
          updated_at: string
          weeks_of_month: number[]
        }
        Insert: {
          athlete_id: string
          coach_id?: string | null
          created_at?: string
          day_of_week: number
          end_minute: number
          frequency?: string
          id?: string
          start_minute: number
          starts_on?: string | null
          updated_at?: string
          weeks_of_month?: number[]
        }
        Update: {
          athlete_id?: string
          coach_id?: string | null
          created_at?: string
          day_of_week?: number
          end_minute?: number
          frequency?: string
          id?: string
          start_minute?: number
          starts_on?: string | null
          updated_at?: string
          weeks_of_month?: number[]
        }
        Relationships: []
      }
      athlete_primary_coaches: {
        Row: {
          athlete_id: string
          coach_id: string
          created_at: string
          id: string
          sport: string
          updated_at: string
        }
        Insert: {
          athlete_id: string
          coach_id: string
          created_at?: string
          id?: string
          sport: string
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          coach_id?: string
          created_at?: string
          id?: string
          sport?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "athlete_primary_coaches_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "athlete_primary_coaches_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_skill_events: {
        Row: {
          athlete_id: string
          coach_id: string | null
          competition_id: string | null
          confidence: number
          created_at: string
          created_by_user_id: string | null
          element_code: string | null
          element_ref: string | null
          id: string
          kind: string
          move_category: string
          move_id: string | null
          move_name: string
          occurred_at: string
          origin: string | null
          plan_id: string | null
          plan_move_id: string | null
          source: string
          sport: string
          started_at: string | null
        }
        Insert: {
          athlete_id: string
          coach_id?: string | null
          competition_id?: string | null
          confidence?: number
          created_at?: string
          created_by_user_id?: string | null
          element_code?: string | null
          element_ref?: string | null
          id?: string
          kind: string
          move_category?: string
          move_id?: string | null
          move_name?: string
          occurred_at?: string
          origin?: string | null
          plan_id?: string | null
          plan_move_id?: string | null
          source: string
          sport?: string
          started_at?: string | null
        }
        Update: {
          athlete_id?: string
          coach_id?: string | null
          competition_id?: string | null
          confidence?: number
          created_at?: string
          created_by_user_id?: string | null
          element_code?: string | null
          element_ref?: string | null
          id?: string
          kind?: string
          move_category?: string
          move_id?: string | null
          move_name?: string
          occurred_at?: string
          origin?: string | null
          plan_id?: string | null
          plan_move_id?: string | null
          source?: string
          sport?: string
          started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "athlete_skill_events_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "athlete_skill_events_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "athlete_skill_events_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "athlete_skill_events_move_id_fkey"
            columns: ["move_id"]
            isOneToOne: false
            referencedRelation: "moves"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "athlete_skill_events_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      athletes: {
        Row: {
          added_by_coach_id: string | null
          birthdate: string | null
          created_at: string
          first_name: string
          guardian_claim_code: string | null
          guardian_claim_token: string | null
          guardian_claimed_at: string | null
          guardian_email: string | null
          guardian_invited_at: string | null
          id: string
          invite_recipient: string | null
          is_test: boolean
          last_name: string
          motivation: string
          parent_id: string | null
          promo_code: string | null
          self_managed: boolean
          updated_at: string
          user_id: string | null
          username: string | null
        }
        Insert: {
          added_by_coach_id?: string | null
          birthdate?: string | null
          created_at?: string
          first_name: string
          guardian_claim_code?: string | null
          guardian_claim_token?: string | null
          guardian_claimed_at?: string | null
          guardian_email?: string | null
          guardian_invited_at?: string | null
          id?: string
          invite_recipient?: string | null
          is_test?: boolean
          last_name?: string
          motivation?: string
          parent_id?: string | null
          promo_code?: string | null
          self_managed?: boolean
          updated_at?: string
          user_id?: string | null
          username?: string | null
        }
        Update: {
          added_by_coach_id?: string | null
          birthdate?: string | null
          created_at?: string
          first_name?: string
          guardian_claim_code?: string | null
          guardian_claim_token?: string | null
          guardian_claimed_at?: string | null
          guardian_email?: string | null
          guardian_invited_at?: string | null
          id?: string
          invite_recipient?: string | null
          is_test?: boolean
          last_name?: string
          motivation?: string
          parent_id?: string | null
          promo_code?: string | null
          self_managed?: boolean
          updated_at?: string
          user_id?: string | null
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "athletes_added_by_coach_id_fkey"
            columns: ["added_by_coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "athletes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "parent_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "athletes_promo_code_fkey"
            columns: ["promo_code"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["code"]
          },
        ]
      }
      auth_identities: {
        Row: {
          apple_refresh_token: string | null
          created_at: string
          email: string | null
          id: string
          provider: string
          provider_sub: string
          user_id: string
        }
        Insert: {
          apple_refresh_token?: string | null
          created_at?: string
          email?: string | null
          id?: string
          provider: string
          provider_sub: string
          user_id: string
        }
        Update: {
          apple_refresh_token?: string | null
          created_at?: string
          email?: string | null
          id?: string
          provider?: string
          provider_sub?: string
          user_id?: string
        }
        Relationships: []
      }
      billing_events: {
        Row: {
          amount_cents: number | null
          created_at: string
          currency: string | null
          environment: string
          event_type: string
          id: string
          payload: Json
          period_end: string | null
          period_start: string | null
          status: string | null
          stripe_customer_id: string | null
          stripe_event_id: string
          stripe_invoice_id: string | null
          stripe_subscription_id: string | null
          user_id: string | null
        }
        Insert: {
          amount_cents?: number | null
          created_at?: string
          currency?: string | null
          environment?: string
          event_type: string
          id?: string
          payload?: Json
          period_end?: string | null
          period_start?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_event_id: string
          stripe_invoice_id?: string | null
          stripe_subscription_id?: string | null
          user_id?: string | null
        }
        Update: {
          amount_cents?: number | null
          created_at?: string
          currency?: string | null
          environment?: string
          event_type?: string
          id?: string
          payload?: Json
          period_end?: string | null
          period_start?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_event_id?: string
          stripe_invoice_id?: string | null
          stripe_subscription_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      board_follows: {
        Row: {
          competition_slug: string
          created_at: string
          device_id: string | null
          id: string
          skater_name: string
          source: string
          user_id: string | null
        }
        Insert: {
          competition_slug: string
          created_at?: string
          device_id?: string | null
          id?: string
          skater_name: string
          source?: string
          user_id?: string | null
        }
        Update: {
          competition_slug?: string
          created_at?: string
          device_id?: string | null
          id?: string
          skater_name?: string
          source?: string
          user_id?: string | null
        }
        Relationships: []
      }
      client_errors: {
        Row: {
          created_at: string
          environment: string
          id: string
          message: string
          metadata: Json
          route: string | null
          source: string
          stack: string | null
          user_agent: string | null
          user_email: string | null
          user_id: string | null
          user_name: string | null
          user_role: string | null
        }
        Insert: {
          created_at?: string
          environment?: string
          id?: string
          message: string
          metadata?: Json
          route?: string | null
          source: string
          stack?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
          user_name?: string | null
          user_role?: string | null
        }
        Update: {
          created_at?: string
          environment?: string
          id?: string
          message?: string
          metadata?: Json
          route?: string | null
          source?: string
          stack?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
          user_name?: string | null
          user_role?: string | null
        }
        Relationships: []
      }
      coach_athlete_practice_targets: {
        Row: {
          athlete_id: string
          coach_id: string
          created_at: string
          hours_per_week: number
          id: string
          sport: string
          updated_at: string
        }
        Insert: {
          athlete_id: string
          coach_id: string
          created_at?: string
          hours_per_week: number
          id?: string
          sport: string
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          coach_id?: string
          created_at?: string
          hours_per_week?: number
          id?: string
          sport?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_athlete_practice_targets_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_athlete_practice_targets_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_athlete_rates: {
        Row: {
          athlete_id: string
          coach_id: string
          created_at: string
          id: string
          rate_cents: number
          rate_kind: string
          updated_at: string
        }
        Insert: {
          athlete_id: string
          coach_id: string
          created_at?: string
          id?: string
          rate_cents: number
          rate_kind: string
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          coach_id?: string
          created_at?: string
          id?: string
          rate_cents?: number
          rate_kind?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_athlete_rates_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_athlete_rates_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_athlete_sports: {
        Row: {
          athlete_id: string
          coach_id: string
          created_at: string
          id: string
          sport: string
          updated_at: string
        }
        Insert: {
          athlete_id: string
          coach_id: string
          created_at?: string
          id?: string
          sport: string
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          coach_id?: string
          created_at?: string
          id?: string
          sport?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_athlete_sports_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_athlete_sports_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_athletes: {
        Row: {
          athlete_id: string
          coach_ack_at: string | null
          coach_id: string
          created_at: string
          id: string
          other_ack_at: string | null
        }
        Insert: {
          athlete_id: string
          coach_ack_at?: string | null
          coach_id: string
          created_at?: string
          id?: string
          other_ack_at?: string | null
        }
        Update: {
          athlete_id?: string
          coach_ack_at?: string | null
          coach_id?: string
          created_at?: string
          id?: string
          other_ack_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coach_athletes_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_athletes_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_invite_codes: {
        Row: {
          coach_id: string
          code: string
          created_at: string
          id: string
          updated_at: string
        }
        Insert: {
          coach_id: string
          code: string
          created_at?: string
          id?: string
          updated_at?: string
        }
        Update: {
          coach_id?: string
          code?: string
          created_at?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_invite_codes_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: true
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_levels: {
        Row: {
          coach_id: string
          created_at: string
          id: string
          level_key: string
          practice_hours_per_week: number
          sport: string
          updated_at: string
        }
        Insert: {
          coach_id: string
          created_at?: string
          id?: string
          level_key: string
          practice_hours_per_week?: number
          sport: string
          updated_at?: string
        }
        Update: {
          coach_id?: string
          created_at?: string
          id?: string
          level_key?: string
          practice_hours_per_week?: number
          sport?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_levels_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_profiles: {
        Row: {
          created_at: string
          current_period_end: string | null
          entitlement: string
          first_name: string
          founding_coach: boolean
          founding_pro_trial_started_at: string | null
          founding_pro_trial_used: boolean
          free_access_until: string | null
          id: string
          is_org_admin: boolean
          is_test: boolean
          last_name: string
          last_seen_at: string | null
          last_synced_content_version: number
          onboarded_at: string | null
          organization_id: string | null
          promo_code: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_environment: string | null
          subscription_status: string | null
          subscription_tier: string | null
          trial_ends_at: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          entitlement?: string
          first_name?: string
          founding_coach?: boolean
          founding_pro_trial_started_at?: string | null
          founding_pro_trial_used?: boolean
          free_access_until?: string | null
          id?: string
          is_org_admin?: boolean
          is_test?: boolean
          last_name?: string
          last_seen_at?: string | null
          last_synced_content_version?: number
          onboarded_at?: string | null
          organization_id?: string | null
          promo_code?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_environment?: string | null
          subscription_status?: string | null
          subscription_tier?: string | null
          trial_ends_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          entitlement?: string
          first_name?: string
          founding_coach?: boolean
          founding_pro_trial_started_at?: string | null
          founding_pro_trial_used?: boolean
          free_access_until?: string | null
          id?: string
          is_org_admin?: boolean
          is_test?: boolean
          last_name?: string
          last_seen_at?: string | null
          last_synced_content_version?: number
          onboarded_at?: string | null
          organization_id?: string | null
          promo_code?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_environment?: string | null
          subscription_status?: string | null
          subscription_tier?: string | null
          trial_ends_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coach_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_profiles_promo_code_fkey"
            columns: ["promo_code"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["code"]
          },
        ]
      }
      coach_visibility_links: {
        Row: {
          a_status: string
          athlete_id: string
          b_status: string
          coach_a_id: string
          coach_b_id: string
          created_at: string
          id: string
          updated_at: string
        }
        Insert: {
          a_status?: string
          athlete_id: string
          b_status?: string
          coach_a_id: string
          coach_b_id: string
          created_at?: string
          id?: string
          updated_at?: string
        }
        Update: {
          a_status?: string
          athlete_id?: string
          b_status?: string
          coach_a_id?: string
          coach_b_id?: string
          created_at?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_visibility_links_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_visibility_links_coach_a_id_fkey"
            columns: ["coach_a_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_visibility_links_coach_b_id_fkey"
            columns: ["coach_b_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_attendance: {
        Row: {
          athlete_id: string | null
          competition_id: string
          dismissed_at: string | null
          first_seen_at: string
          id: string
          recap_done_at: string | null
          skater_name: string
          user_id: string
          viewer_role: string
        }
        Insert: {
          athlete_id?: string | null
          competition_id: string
          dismissed_at?: string | null
          first_seen_at?: string
          id?: string
          recap_done_at?: string | null
          skater_name?: string
          user_id: string
          viewer_role?: string
        }
        Update: {
          athlete_id?: string | null
          competition_id?: string
          dismissed_at?: string | null
          first_seen_at?: string
          id?: string
          recap_done_at?: string | null
          skater_name?: string
          user_id?: string
          viewer_role?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_attendance_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_attendance_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_recap_prompts_sent: {
        Row: {
          competition_id: string
          created_at: string
          id: string
          sent_at: string | null
          user_id: string
        }
        Insert: {
          competition_id: string
          created_at?: string
          id?: string
          sent_at?: string | null
          user_id: string
        }
        Update: {
          competition_id?: string
          created_at?: string
          id?: string
          sent_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_recap_prompts_sent_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_recaps: {
        Row: {
          athlete_id: string
          author_role: string
          author_user_id: string
          body: string
          competition_id: string
          created_at: string
          id: string
          updated_at: string
        }
        Insert: {
          athlete_id: string
          author_role: string
          author_user_id: string
          body: string
          competition_id: string
          created_at?: string
          id?: string
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          author_role?: string
          author_user_id?: string
          body?: string
          competition_id?: string
          created_at?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_recaps_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_recaps_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_snapshots: {
        Row: {
          competition_id: string
          error: string | null
          fetch_count: number
          generated_at: string | null
          orders: Json
          payload: Json
          refreshing_at: string | null
          skater_index: Json
          updated_at: string
          venues: Json
          view_count: number
        }
        Insert: {
          competition_id: string
          error?: string | null
          fetch_count?: number
          generated_at?: string | null
          orders?: Json
          payload?: Json
          refreshing_at?: string | null
          skater_index?: Json
          updated_at?: string
          venues?: Json
          view_count?: number
        }
        Update: {
          competition_id?: string
          error?: string | null
          fetch_count?: number
          generated_at?: string | null
          orders?: Json
          payload?: Json
          refreshing_at?: string | null
          skater_index?: Json
          updated_at?: string
          venues?: Json
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "competition_snapshots_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: true
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      competitions: {
        Row: {
          active: boolean
          comp_id: string
          created_at: string
          created_by: string | null
          dates_label: string
          ends_on: string | null
          id: string
          ijs_base_url: string
          location: string
          name: string
          slug: string
          starts_on: string | null
          updated_at: string
          year: number
        }
        Insert: {
          active?: boolean
          comp_id: string
          created_at?: string
          created_by?: string | null
          dates_label?: string
          ends_on?: string | null
          id?: string
          ijs_base_url: string
          location?: string
          name?: string
          slug: string
          starts_on?: string | null
          updated_at?: string
          year: number
        }
        Update: {
          active?: boolean
          comp_id?: string
          created_at?: string
          created_by?: string | null
          dates_label?: string
          ends_on?: string | null
          id?: string
          ijs_base_url?: string
          location?: string
          name?: string
          slug?: string
          starts_on?: string | null
          updated_at?: string
          year?: number
        }
        Relationships: []
      }
      deleted_accounts: {
        Row: {
          created_at: string
          deleted_at: string
          email_hash: string | null
          id: string
          initiated_by: string
          notes: string | null
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string
          email_hash?: string | null
          id?: string
          initiated_by?: string
          notes?: string | null
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string
          email_hash?: string | null
          id?: string
          initiated_by?: string
          notes?: string | null
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      device_tokens: {
        Row: {
          created_at: string
          id: string
          last_seen_at: string
          platform: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_seen_at?: string
          platform: string
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_seen_at?: string
          platform?: string
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      direct_rooms: {
        Row: {
          coach_a_id: string | null
          coach_b_id: string | null
          coach_id: string | null
          created_at: string
          id: string
          kind: string
          parent_id: string | null
          updated_at: string
          user_a: string
          user_b: string
        }
        Insert: {
          coach_a_id?: string | null
          coach_b_id?: string | null
          coach_id?: string | null
          created_at?: string
          id?: string
          kind: string
          parent_id?: string | null
          updated_at?: string
          user_a: string
          user_b: string
        }
        Update: {
          coach_a_id?: string | null
          coach_b_id?: string | null
          coach_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          parent_id?: string | null
          updated_at?: string
          user_a?: string
          user_b?: string
        }
        Relationships: [
          {
            foreignKeyName: "direct_rooms_coach_a_id_fkey"
            columns: ["coach_a_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_rooms_coach_b_id_fkey"
            columns: ["coach_b_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_rooms_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_rooms_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "parent_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_template_override_history: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          id: string
          slot_key: string
          template_name: string
          value: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          id?: string
          slot_key: string
          template_name: string
          value: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          id?: string
          slot_key?: string
          template_name?: string
          value?: string
        }
        Relationships: []
      }
      email_template_overrides: {
        Row: {
          slot_key: string
          template_name: string
          updated_at: string
          updated_by: string | null
          value: string
        }
        Insert: {
          slot_key: string
          template_name: string
          updated_at?: string
          updated_by?: string | null
          value: string
        }
        Update: {
          slot_key?: string
          template_name?: string
          updated_at?: string
          updated_by?: string | null
          value?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      error_group_explanations: {
        Row: {
          created_at: string
          explanation: string
          id: string
          model: string | null
          sample_message: string
          signature: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          explanation: string
          id?: string
          model?: string | null
          sample_message: string
          signature: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          explanation?: string
          id?: string
          model?: string | null
          sample_message?: string
          signature?: string
          updated_at?: string
        }
        Relationships: []
      }
      feedback: {
        Row: {
          created_at: string
          id: string
          message: string
          path: string | null
          resolved_at: string | null
          role: string
          user_agent: string | null
          user_id: string
          viewport: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          path?: string | null
          resolved_at?: string | null
          role: string
          user_agent?: string | null
          user_id: string
          viewport?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          path?: string | null
          resolved_at?: string | null
          role?: string
          user_agent?: string | null
          user_id?: string
          viewport?: string | null
        }
        Relationships: []
      }
      guardian_invites: {
        Row: {
          athlete_id: string
          claimed_at: string | null
          claimed_by: string | null
          code: string
          created_at: string
          email: string | null
          expires_at: string | null
          id: string
          invited_by_parent_id: string
          status: string
          token: string
          updated_at: string
        }
        Insert: {
          athlete_id: string
          claimed_at?: string | null
          claimed_by?: string | null
          code: string
          created_at?: string
          email?: string | null
          expires_at?: string | null
          id?: string
          invited_by_parent_id: string
          status?: string
          token: string
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          claimed_at?: string | null
          claimed_by?: string | null
          code?: string
          created_at?: string
          email?: string | null
          expires_at?: string | null
          id?: string
          invited_by_parent_id?: string
          status?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guardian_invites_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_invites_invited_by_parent_id_fkey"
            columns: ["invited_by_parent_id"]
            isOneToOne: false
            referencedRelation: "parent_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      impersonation_events: {
        Row: {
          admin_email: string | null
          admin_user_id: string
          created_at: string
          id: string
          reason: string | null
          target_email: string | null
          target_user_id: string
        }
        Insert: {
          admin_email?: string | null
          admin_user_id: string
          created_at?: string
          id?: string
          reason?: string | null
          target_email?: string | null
          target_user_id: string
        }
        Update: {
          admin_email?: string | null
          admin_user_id?: string
          created_at?: string
          id?: string
          reason?: string | null
          target_email?: string | null
          target_user_id?: string
        }
        Relationships: []
      }
      invite_lookup_attempts: {
        Row: {
          attempted_at: string
          code: string | null
          found: boolean
          id: string
          ip: string
        }
        Insert: {
          attempted_at?: string
          code?: string | null
          found?: boolean
          id?: string
          ip: string
        }
        Update: {
          attempted_at?: string
          code?: string | null
          found?: boolean
          id?: string
          ip?: string
        }
        Relationships: []
      }
      invoice_lines: {
        Row: {
          amount_cents: number
          athlete_id: string
          coach_id: string
          created_at: string
          end_minute: number | null
          id: string
          included_reason: string
          invoice_id: string
          occurrence_date: string
          slot_id: string | null
          start_minute: number | null
        }
        Insert: {
          amount_cents: number
          athlete_id: string
          coach_id: string
          created_at?: string
          end_minute?: number | null
          id?: string
          included_reason?: string
          invoice_id: string
          occurrence_date: string
          slot_id?: string | null
          start_minute?: number | null
        }
        Update: {
          amount_cents?: number
          athlete_id?: string
          coach_id?: string
          created_at?: string
          end_minute?: number | null
          id?: string
          included_reason?: string
          invoice_id?: string
          occurrence_date?: string
          slot_id?: string | null
          start_minute?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "athlete_lesson_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          athlete_id: string
          coach_id: string
          created_at: string
          id: string
          paid_at: string | null
          period_end: string
          period_start: string
          status: string
          total_cents: number
          updated_at: string
        }
        Insert: {
          athlete_id: string
          coach_id: string
          created_at?: string
          id?: string
          paid_at?: string | null
          period_end: string
          period_start: string
          status?: string
          total_cents?: number
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          coach_id?: string
          created_at?: string
          id?: string
          paid_at?: string | null
          period_end?: string
          period_start?: string
          status?: string
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_chunks: {
        Row: {
          coach_id: string | null
          content: string
          content_hash: string
          created_at: string
          embedding: string | null
          id: string
          ordinal: number
          page: number | null
          section: string
          source_id: string
          sport: string
          token_estimate: number
        }
        Insert: {
          coach_id?: string | null
          content?: string
          content_hash: string
          created_at?: string
          embedding?: string | null
          id?: string
          ordinal: number
          page?: number | null
          section?: string
          source_id: string
          sport?: string
          token_estimate?: number
        }
        Update: {
          coach_id?: string | null
          content?: string
          content_hash?: string
          created_at?: string
          embedding?: string | null
          id?: string
          ordinal?: number
          page?: number | null
          section?: string
          source_id?: string
          sport?: string
          token_estimate?: number
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_chunks_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "knowledge_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_pages: {
        Row: {
          page: number
          source_id: string
          text: string
        }
        Insert: {
          page: number
          source_id: string
          text: string
        }
        Update: {
          page?: number
          source_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_pages_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "knowledge_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_sources: {
        Row: {
          chunk_count: number
          chunker: string
          coach_id: string | null
          created_at: string
          created_by: string | null
          edition: string
          embedding_model: string | null
          error: string | null
          external_url: string | null
          id: string
          ingested_at: string | null
          inline_text: string | null
          kind: string
          page_count: number | null
          publisher: string
          quote_allowed: boolean
          resource_id: string | null
          rights_basis: string
          sport: string
          status: string
          storage_path: string | null
          title: string
          updated_at: string
        }
        Insert: {
          chunk_count?: number
          chunker?: string
          coach_id?: string | null
          created_at?: string
          created_by?: string | null
          edition?: string
          embedding_model?: string | null
          error?: string | null
          external_url?: string | null
          id?: string
          ingested_at?: string | null
          inline_text?: string | null
          kind: string
          page_count?: number | null
          publisher?: string
          quote_allowed?: boolean
          resource_id?: string | null
          rights_basis: string
          sport?: string
          status?: string
          storage_path?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          chunk_count?: number
          chunker?: string
          coach_id?: string | null
          created_at?: string
          created_by?: string | null
          edition?: string
          embedding_model?: string | null
          error?: string | null
          external_url?: string | null
          id?: string
          ingested_at?: string | null
          inline_text?: string | null
          kind?: string
          page_count?: number | null
          publisher?: string
          quote_allowed?: boolean
          resource_id?: string | null
          rights_basis?: string
          sport?: string
          status?: string
          storage_path?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_sources_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_sources_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_reminders_sent: {
        Row: {
          athlete_id: string
          coach_id: string | null
          created_at: string
          id: string
          lesson_date: string
          sent_at: string | null
          slot_id: string
        }
        Insert: {
          athlete_id: string
          coach_id?: string | null
          created_at?: string
          id?: string
          lesson_date: string
          sent_at?: string | null
          slot_id: string
        }
        Update: {
          athlete_id?: string
          coach_id?: string | null
          created_at?: string
          id?: string
          lesson_date?: string
          sent_at?: string | null
          slot_id?: string
        }
        Relationships: []
      }
      lesson_slot_overrides: {
        Row: {
          created_at: string
          end_minute: number | null
          id: string
          occurrence_date: string
          slot_id: string
          start_minute: number | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_minute?: number | null
          id?: string
          occurrence_date: string
          slot_id: string
          start_minute?: number | null
          status: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_minute?: number | null
          id?: string
          occurrence_date?: string
          slot_id?: string
          start_minute?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_slot_overrides_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "athlete_lesson_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_wrap_up_prompts_sent: {
        Row: {
          athlete_id: string
          coach_id: string
          created_at: string
          id: string
          lesson_date: string
          sent_at: string | null
          slot_id: string
        }
        Insert: {
          athlete_id: string
          coach_id: string
          created_at?: string
          id?: string
          lesson_date: string
          sent_at?: string | null
          slot_id: string
        }
        Update: {
          athlete_id?: string
          coach_id?: string
          created_at?: string
          id?: string
          lesson_date?: string
          sent_at?: string | null
          slot_id?: string
        }
        Relationships: []
      }
      lesson_wrap_ups: {
        Row: {
          action: string
          athlete_id: string
          coach_id: string
          created_at: string
          id: string
          lesson_date: string
          updated_at: string
        }
        Insert: {
          action: string
          athlete_id: string
          coach_id: string
          created_at?: string
          id?: string
          lesson_date: string
          updated_at?: string
        }
        Update: {
          action?: string
          athlete_id?: string
          coach_id?: string
          created_at?: string
          id?: string
          lesson_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_wrap_ups_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_wrap_ups_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lifecycle_email_jobs: {
        Row: {
          attempts: number
          created_at: string
          id: string
          kind: string
          last_error: string | null
          message_id: string | null
          sent_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          kind: string
          last_error?: string | null
          message_id?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          kind?: string
          last_error?: string | null
          message_id?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      live_activity_sessions: {
        Row: {
          activity_key: string
          competition_slug: string
          ended_at: string | null
          id: string
          last_state: string
          started_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          activity_key: string
          competition_slug: string
          ended_at?: string | null
          id?: string
          last_state: string
          started_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          activity_key?: string
          competition_slug?: string
          ended_at?: string | null
          id?: string
          last_state?: string
          started_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      live_activity_tokens: {
        Row: {
          activity_key: string | null
          created_at: string
          id: string
          kind: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          activity_key?: string | null
          created_at?: string
          id?: string
          kind: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          activity_key?: string | null
          created_at?: string
          id?: string
          kind?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      message_reads: {
        Row: {
          message_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          message_id: string
          read_at?: string
          user_id: string
        }
        Update: {
          message_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reads_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_rooms: {
        Row: {
          athlete_id: string
          coach_id: string
          created_at: string
          id: string
          updated_at: string
        }
        Insert: {
          athlete_id: string
          coach_id: string
          created_at?: string
          id?: string
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          coach_id?: string
          created_at?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          audio_url: string | null
          body: string
          created_at: string
          direct_room_id: string | null
          duration_seconds: number | null
          id: string
          kind: string
          plan_id: string | null
          room_id: string | null
          sender_deleted_at: string | null
          sender_role: string
          sender_user_id: string | null
          transcript: string | null
          transcript_failed_at: string | null
        }
        Insert: {
          audio_url?: string | null
          body?: string
          created_at?: string
          direct_room_id?: string | null
          duration_seconds?: number | null
          id?: string
          kind: string
          plan_id?: string | null
          room_id?: string | null
          sender_deleted_at?: string | null
          sender_role: string
          sender_user_id?: string | null
          transcript?: string | null
          transcript_failed_at?: string | null
        }
        Update: {
          audio_url?: string | null
          body?: string
          created_at?: string
          direct_room_id?: string | null
          duration_seconds?: number | null
          id?: string
          kind?: string
          plan_id?: string | null
          room_id?: string | null
          sender_deleted_at?: string | null
          sender_role?: string
          sender_user_id?: string | null
          transcript?: string | null
          transcript_failed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_direct_room_id_fkey"
            columns: ["direct_room_id"]
            isOneToOne: false
            referencedRelation: "direct_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "message_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      moves: {
        Row: {
          archived_at: string | null
          category: string
          coach_id: string | null
          created_at: string
          cue: string
          default_target_kind: string
          default_target_value: number
          description: string
          id: string
          is_org_template: boolean
          name: string
          organization_id: string | null
          sport: string
          updated_at: string
          why: string
        }
        Insert: {
          archived_at?: string | null
          category?: string
          coach_id?: string | null
          created_at?: string
          cue?: string
          default_target_kind?: string
          default_target_value?: number
          description?: string
          id?: string
          is_org_template?: boolean
          name: string
          organization_id?: string | null
          sport: string
          updated_at?: string
          why?: string
        }
        Update: {
          archived_at?: string | null
          category?: string
          coach_id?: string | null
          created_at?: string
          cue?: string
          default_target_kind?: string
          default_target_value?: number
          description?: string
          id?: string
          is_org_template?: boolean
          name?: string
          organization_id?: string | null
          sport?: string
          updated_at?: string
          why?: string
        }
        Relationships: [
          {
            foreignKeyName: "moves_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moves_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_admin_actions: {
        Row: {
          action: string
          actor_user_id: string
          created_at: string
          id: string
          organization_id: string
          payload: Json
          target_coach_id: string | null
        }
        Insert: {
          action: string
          actor_user_id: string
          created_at?: string
          id?: string
          organization_id: string
          payload?: Json
          target_coach_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          payload?: Json
          target_coach_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_admin_actions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_admin_actions_target_coach_id_fkey"
            columns: ["target_coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      org_admins: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_admins_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_coach_invites: {
        Row: {
          accepted_at: string | null
          accepted_user_id: string | null
          created_at: string
          email: string | null
          expires_at: string
          id: string
          invite_code: string
          invite_token: string
          invited_by: string | null
          organization_id: string
          phone: string | null
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          invite_code: string
          invite_token: string
          invited_by?: string | null
          organization_id: string
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          invite_code?: string
          invite_token?: string
          invited_by?: string | null
          organization_id?: string
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_coach_invites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invite_codes: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          organization_id: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          organization_id: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invite_codes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_leads: {
        Row: {
          admin_notes: string | null
          channel: string
          coach_email: string
          coach_user_id: string
          created_at: string
          id: string
          message_body: string
          requested_org_city: string | null
          requested_org_name: string
          status: string
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          channel: string
          coach_email: string
          coach_user_id: string
          created_at?: string
          id?: string
          message_body: string
          requested_org_city?: string | null
          requested_org_name: string
          status?: string
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          channel?: string
          coach_email?: string
          coach_user_id?: string
          created_at?: string
          id?: string
          message_body?: string
          requested_org_city?: string | null
          requested_org_name?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      organizations: {
        Row: {
          active: boolean
          city: string | null
          content_version: number
          created_at: string
          id: string
          is_listed: boolean
          logo_url: string | null
          name: string
          notes: string | null
          region: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          city?: string | null
          content_version?: number
          created_at?: string
          id?: string
          is_listed?: boolean
          logo_url?: string | null
          name: string
          notes?: string | null
          region?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          city?: string | null
          content_version?: number
          created_at?: string
          id?: string
          is_listed?: boolean
          logo_url?: string | null
          name?: string
          notes?: string | null
          region?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      parent_invite_codes: {
        Row: {
          code: string
          created_at: string
          id: string
          parent_id: string
          promo_code: string | null
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          parent_id: string
          promo_code?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          parent_id?: string
          promo_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parent_invite_codes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: true
            referencedRelation: "parent_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_invite_codes_promo_code_fkey"
            columns: ["promo_code"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["code"]
          },
        ]
      }
      parent_profiles: {
        Row: {
          coach_id: string | null
          created_at: string
          current_period_end: string | null
          first_name: string
          id: string
          is_test: boolean
          last_name: string
          last_seen_at: string | null
          promo_code: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_environment: string | null
          subscription_status: string | null
          team_plan_seats: number
          updated_at: string
          user_id: string
        }
        Insert: {
          coach_id?: string | null
          created_at?: string
          current_period_end?: string | null
          first_name?: string
          id?: string
          is_test?: boolean
          last_name?: string
          last_seen_at?: string | null
          promo_code?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_environment?: string | null
          subscription_status?: string | null
          team_plan_seats?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          coach_id?: string | null
          created_at?: string
          current_period_end?: string | null
          first_name?: string
          id?: string
          is_test?: boolean
          last_name?: string
          last_seen_at?: string | null
          promo_code?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_environment?: string | null
          subscription_status?: string | null
          team_plan_seats?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parent_profiles_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_profiles_promo_code_fkey"
            columns: ["promo_code"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["code"]
          },
        ]
      }
      parent_saved_answers: {
        Row: {
          answer: string
          created_at: string
          id: string
          question: string
          sport: string
          user_id: string
        }
        Insert: {
          answer: string
          created_at?: string
          id?: string
          question: string
          sport: string
          user_id: string
        }
        Update: {
          answer?: string
          created_at?: string
          id?: string
          question?: string
          sport?: string
          user_id?: string
        }
        Relationships: []
      }
      plan_moves: {
        Row: {
          created_at: string
          cue: string
          description: string
          id: string
          move_id: string | null
          name: string
          plan_id: string
          position: number
          target_kind: string
          target_value: number
          why: string
        }
        Insert: {
          created_at?: string
          cue?: string
          description?: string
          id?: string
          move_id?: string | null
          name: string
          plan_id: string
          position?: number
          target_kind: string
          target_value?: number
          why?: string
        }
        Update: {
          created_at?: string
          cue?: string
          description?: string
          id?: string
          move_id?: string | null
          name?: string
          plan_id?: string
          position?: number
          target_kind?: string
          target_value?: number
          why?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_moves_move_id_fkey"
            columns: ["move_id"]
            isOneToOne: false
            referencedRelation: "moves"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_moves_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_sessions: {
        Row: {
          athlete_id: string
          created_at: string
          duration_seconds: number
          id: string
          logged_at: string
          note: string
          parent_id: string | null
          plan_id: string
          state_index: number
        }
        Insert: {
          athlete_id: string
          created_at?: string
          duration_seconds?: number
          id?: string
          logged_at?: string
          note?: string
          parent_id?: string | null
          plan_id: string
          state_index: number
        }
        Update: {
          athlete_id?: string
          created_at?: string
          duration_seconds?: number
          id?: string
          logged_at?: string
          note?: string
          parent_id?: string | null
          plan_id?: string
          state_index?: number
        }
        Relationships: []
      }
      plans: {
        Row: {
          athlete_id: string | null
          coach_id: string | null
          created_at: string
          id: string
          is_org_template: boolean
          kind: string
          notes: string
          organization_id: string | null
          share_token: string | null
          shared_at: string | null
          source: string
          source_competition_id: string | null
          status: string
          title: string
          updated_at: string
          voice_transcript: string | null
        }
        Insert: {
          athlete_id?: string | null
          coach_id?: string | null
          created_at?: string
          id?: string
          is_org_template?: boolean
          kind: string
          notes?: string
          organization_id?: string | null
          share_token?: string | null
          shared_at?: string | null
          source?: string
          source_competition_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          voice_transcript?: string | null
        }
        Update: {
          athlete_id?: string | null
          coach_id?: string | null
          created_at?: string
          id?: string
          is_org_template?: boolean
          kind?: string
          notes?: string
          organization_id?: string | null
          share_token?: string | null
          shared_at?: string | null
          source?: string
          source_competition_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          voice_transcript?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plans_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plans_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plans_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plans_source_competition_id_fkey"
            columns: ["source_competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      pre_lesson_briefings: {
        Row: {
          athlete_id: string
          coach_id: string
          created_at: string
          generated_at: string
          id: string
          lesson_date: string
          narrative: string
          source_hash: string
          updated_at: string
        }
        Insert: {
          athlete_id: string
          coach_id: string
          created_at?: string
          generated_at?: string
          id?: string
          lesson_date: string
          narrative: string
          source_hash: string
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          coach_id?: string
          created_at?: string
          generated_at?: string
          id?: string
          lesson_date?: string
          narrative?: string
          source_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pre_lesson_briefings_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pre_lesson_briefings_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_codes: {
        Row: {
          active: boolean
          applies_to_plans: string[]
          card_required: boolean
          code: string
          created_at: string
          duration: string
          duration_in_months: number | null
          label: string
          notes: string | null
          percent_off: number
          stripe_coupon_id_live: string | null
          stripe_coupon_id_sandbox: string | null
          stripe_promo_id_live: string | null
          stripe_promo_id_sandbox: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          applies_to_plans?: string[]
          card_required?: boolean
          code: string
          created_at?: string
          duration?: string
          duration_in_months?: number | null
          label: string
          notes?: string | null
          percent_off?: number
          stripe_coupon_id_live?: string | null
          stripe_coupon_id_sandbox?: string | null
          stripe_promo_id_live?: string | null
          stripe_promo_id_sandbox?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          applies_to_plans?: string[]
          card_required?: boolean
          code?: string
          created_at?: string
          duration?: string
          duration_in_months?: number | null
          label?: string
          notes?: string | null
          percent_off?: number
          stripe_coupon_id_live?: string | null
          stripe_coupon_id_sandbox?: string | null
          stripe_promo_id_live?: string | null
          stripe_promo_id_sandbox?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      resource_sports: {
        Row: {
          resource_id: string
          sport: string
        }
        Insert: {
          resource_id: string
          sport: string
        }
        Update: {
          resource_id?: string
          sport?: string
        }
        Relationships: [
          {
            foreignKeyName: "resource_sports_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
        ]
      }
      resources: {
        Row: {
          coach_id: string | null
          created_at: string
          description: string
          display_order: number
          external_url: string | null
          id: string
          is_org_template: boolean
          kind: string
          organization_id: string | null
          published: boolean
          sport: string
          storage_path: string | null
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          coach_id?: string | null
          created_at?: string
          description?: string
          display_order?: number
          external_url?: string | null
          id?: string
          is_org_template?: boolean
          kind?: string
          organization_id?: string | null
          published?: boolean
          sport: string
          storage_path?: string | null
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          coach_id?: string | null
          created_at?: string
          description?: string
          display_order?: number
          external_url?: string | null
          id?: string
          is_org_template?: boolean
          kind?: string
          organization_id?: string | null
          published?: boolean
          sport?: string
          storage_path?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resources_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      seed_moves: {
        Row: {
          category: string
          created_at: string
          cue: string
          default_target_kind: string
          default_target_value: number
          description: string
          id: string
          name: string
          sport: string
          why: string
        }
        Insert: {
          category: string
          created_at?: string
          cue?: string
          default_target_kind: string
          default_target_value?: number
          description?: string
          id?: string
          name: string
          sport: string
          why?: string
        }
        Update: {
          category?: string
          created_at?: string
          cue?: string
          default_target_kind?: string
          default_target_value?: number
          description?: string
          id?: string
          name?: string
          sport?: string
          why?: string
        }
        Relationships: []
      }
      skill_inference_runs: {
        Row: {
          candidates: number
          enabled: boolean
          failed_plans: number
          false_negative: number
          false_positive: number
          id: string
          labeled: number
          precision: number | null
          ran_at: string
          true_positive: number
          written_events: number
          written_plans: number
        }
        Insert: {
          candidates?: number
          enabled?: boolean
          failed_plans?: number
          false_negative?: number
          false_positive?: number
          id?: string
          labeled?: number
          precision?: number | null
          ran_at?: string
          true_positive?: number
          written_events?: number
          written_plans?: number
        }
        Update: {
          candidates?: number
          enabled?: boolean
          failed_plans?: number
          false_negative?: number
          false_positive?: number
          id?: string
          labeled?: number
          precision?: number | null
          ran_at?: string
          true_positive?: number
          written_events?: number
          written_plans?: number
        }
        Relationships: []
      }
      soft_deleted_users: {
        Row: {
          deleted_at: string
          deleted_by: string | null
          reason: string | null
          user_id: string
        }
        Insert: {
          deleted_at?: string
          deleted_by?: string | null
          reason?: string | null
          user_id: string
        }
        Update: {
          deleted_at?: string
          deleted_by?: string | null
          reason?: string | null
          user_id?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      terms_acceptances: {
        Row: {
          accepted_at: string
          id: string
          ip: string | null
          role: string
          terms_version: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          accepted_at?: string
          id?: string
          ip?: string | null
          role: string
          terms_version: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          accepted_at?: string
          id?: string
          ip?: string | null
          role?: string
          terms_version?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_applied_promo_codes: {
        Row: {
          applied_by: string | null
          code: string
          created_at: string
          environment: string | null
          id: string
          scope: string
          stripe_subscription_id: string | null
          user_id: string
        }
        Insert: {
          applied_by?: string | null
          code: string
          created_at?: string
          environment?: string | null
          id?: string
          scope: string
          stripe_subscription_id?: string | null
          user_id: string
        }
        Update: {
          applied_by?: string | null
          code?: string
          created_at?: string
          environment?: string | null
          id?: string
          scope?: string
          stripe_subscription_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_applied_promo_codes_code_fkey"
            columns: ["code"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["code"]
          },
        ]
      }
      user_blocks: {
        Row: {
          blocked_user_id: string
          blocker_user_id: string
          created_at: string
          id: string
        }
        Insert: {
          blocked_user_id: string
          blocker_user_id: string
          created_at?: string
          id?: string
        }
        Update: {
          blocked_user_id?: string
          blocker_user_id?: string
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      user_reports: {
        Row: {
          admin_notes: string
          created_at: string
          id: string
          message_id: string | null
          note: string
          reason: string
          reported_user_id: string | null
          reporter_user_id: string
          resource_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          admin_notes?: string
          created_at?: string
          id?: string
          message_id?: string | null
          note?: string
          reason: string
          reported_user_id?: string | null
          reporter_user_id: string
          resource_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          admin_notes?: string
          created_at?: string
          id?: string
          message_id?: string | null
          note?: string
          reason?: string
          reported_user_id?: string | null
          reporter_user_id?: string
          resource_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_reports_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_reports_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      activate_plan: { Args: { _plan_id: string }; Returns: undefined }
      admin_run_readonly_sql: { Args: { _sql: string }; Returns: Json }
      athlete_can_self_connect: {
        Args: { _athlete_id: string }
        Returns: boolean
      }
      athlete_has_coach_upload: {
        Args: { _resource_id: string }
        Returns: boolean
      }
      athlete_has_sport: { Args: { _sport: string }; Returns: boolean }
      caller_is_resource_owner: {
        Args: { _coach_id: string }
        Returns: boolean
      }
      caller_owns_coach: { Args: { _coach_id: string }; Returns: boolean }
      can_subscribe_message_topic: {
        Args: { _topic: string; _user_id: string }
        Returns: boolean
      }
      can_view_plan: { Args: { _plan_id: string }; Returns: boolean }
      can_view_shared_coach_plan: {
        Args: { _athlete_id: string; _owner_coach_id: string }
        Returns: boolean
      }
      coach_effective_tier: { Args: { _coach_id: string }; Returns: string }
      coach_has_rostered_athlete_of_parent: {
        Args: { _parent_id: string }
        Returns: boolean
      }
      coaches_linked_for_athlete: {
        Args: {
          _athlete_id: string
          _owner_coach_id: string
          _viewer_coach_id: string
        }
        Returns: boolean
      }
      column_default_text: {
        Args: { col: unknown; tbl: unknown }
        Returns: string
      }
      complete_idempotency_key: {
        Args: {
          _key: string
          _response_body: Json
          _response_status: number
          _user_id: string
        }
        Returns: undefined
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      enqueue_lifecycle_email: {
        Args: { _kind: string; _user_id: string }
        Returns: undefined
      }
      find_confirmed_user_by_email: {
        Args: { _email: string }
        Returns: string
      }
      get_adult_athlete_by_invite_code: {
        Args: { _code: string }
        Returns: {
          athlete_id: string
          first_name: string
          last_name: string
        }[]
      }
      get_parent_by_invite_code: {
        Args: { _code: string }
        Returns: {
          athlete_count: number
          first_name: string
          last_name: string
          parent_id: string
        }[]
      }
      get_shared_plan: { Args: { _token: string }; Returns: Json }
      guardian_can_write_athlete: {
        Args: { _athlete_id: string }
        Returns: boolean
      }
      has_org_admin: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      import_shared_plan: { Args: { _token: string }; Returns: string }
      is_any_org_admin: { Args: { _user_id: string }; Returns: boolean }
      is_direct_room_participant: {
        Args: { _direct_room_id: string; _user_id: string }
        Returns: boolean
      }
      is_parent_of_athlete: { Args: { _athlete_id: string }; Returns: boolean }
      is_parent_of_plan: { Args: { _plan_id: string }; Returns: boolean }
      is_privileged_writer: { Args: never; Returns: boolean }
      is_room_participant: {
        Args: { _room_id: string; _user_id: string }
        Returns: boolean
      }
      is_self_managed_athlete: {
        Args: { _athlete_id: string }
        Returns: boolean
      }
      is_service_caller: { Args: never; Returns: boolean }
      match_knowledge_chunks: {
        Args: {
          p_coach_ids: string[]
          p_limit: number
          p_sport: string
          query_embedding: string
        }
        Returns: {
          chunk_id: string
          content: string
          edition: string
          external_url: string
          page: number
          publisher: string
          quote_allowed: boolean
          resource_id: string
          section: string
          similarity: number
          source_id: string
          title: string
        }[]
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      my_coach_id: { Args: never; Returns: string }
      new_guardian_claim_code: { Args: never; Returns: string }
      parent_athlete_ids: { Args: never; Returns: string[] }
      parent_can_write: { Args: { _athlete_id: string }; Returns: boolean }
      parent_has_athlete_in_sport: {
        Args: { _sport: string }
        Returns: boolean
      }
      parent_has_coach_upload: {
        Args: { _resource_id: string }
        Returns: boolean
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      record_invite_lookup_attempt: {
        Args: {
          _code: string
          _ip: string
          _max_per_window: number
          _window_seconds: number
        }
        Returns: number
      }
      release_idempotency_key: {
        Args: { _key: string; _user_id: string }
        Returns: undefined
      }
      reserve_idempotency_key: {
        Args: {
          _key: string
          _pending_timeout_seconds: number
          _replay_window_seconds: number
          _request_hash: string
          _user_id: string
        }
        Returns: {
          response_body: Json
          response_status: number
          state: string
        }[]
      }
      seed_coach_library: { Args: { _coach_id: string }; Returns: number }
      shares_athlete_window: { Args: { _athlete_id: string }; Returns: boolean }
      team_plan_active: { Args: { _athlete_id: string }; Returns: boolean }
      touch_last_seen: { Args: never; Returns: undefined }
      users_blocked: { Args: { _a: string; _b: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin"],
    },
  },
} as const
