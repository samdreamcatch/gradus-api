export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      admin_allowlist: {
        Row: {
          created_at: string;
          email: string;
        };
        Insert: {
          created_at?: string;
          email: string;
        };
        Update: {
          created_at?: string;
          email?: string;
        };
        Relationships: [];
      };
      adult_athlete_invite_codes: {
        Row: {
          athlete_id: string;
          code: string;
          created_at: string;
          id: string;
          promo_code: string | null;
        };
        Insert: {
          athlete_id: string;
          code: string;
          created_at?: string;
          id?: string;
          promo_code?: string | null;
        };
        Update: {
          athlete_id?: string;
          code?: string;
          created_at?: string;
          id?: string;
          promo_code?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "adult_athlete_invite_codes_athlete_id_fkey";
            columns: ["athlete_id"];
            isOneToOne: true;
            referencedRelation: "athletes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "adult_athlete_invite_codes_promo_code_fkey";
            columns: ["promo_code"];
            isOneToOne: false;
            referencedRelation: "promo_codes";
            referencedColumns: ["code"];
          },
        ];
      };
      athlete_goals: {
        Row: {
          athlete_id: string;
          coach_id: string | null;
          created_at: string;
          current_level_key: string;
          id: string;
          long_term_goal: string;
          season_goal_key: string;
          sport: string;
          updated_at: string;
        };
        Insert: {
          athlete_id: string;
          coach_id?: string | null;
          created_at?: string;
          current_level_key: string;
          id?: string;
          long_term_goal?: string;
          season_goal_key: string;
          sport: string;
          updated_at?: string;
        };
        Update: {
          athlete_id?: string;
          coach_id?: string | null;
          created_at?: string;
          current_level_key?: string;
          id?: string;
          long_term_goal?: string;
          season_goal_key?: string;
          sport?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      athlete_invite_codes: {
        Row: {
          athlete_id: string;
          claimed_at: string | null;
          claimed_by: string | null;
          code: string;
          created_at: string;
          expires_at: string | null;
          id: string;
          parent_id: string;
          promo_code: string | null;
          updated_at: string;
          used_at: string | null;
        };
        Insert: {
          athlete_id: string;
          claimed_at?: string | null;
          claimed_by?: string | null;
          code: string;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          parent_id: string;
          promo_code?: string | null;
          updated_at?: string;
          used_at?: string | null;
        };
        Update: {
          athlete_id?: string;
          claimed_at?: string | null;
          claimed_by?: string | null;
          code?: string;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          parent_id?: string;
          promo_code?: string | null;
          updated_at?: string;
          used_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "athlete_invite_codes_promo_code_fkey";
            columns: ["promo_code"];
            isOneToOne: false;
            referencedRelation: "promo_codes";
            referencedColumns: ["code"];
          },
        ];
      };
      athlete_lesson_slots: {
        Row: {
          athlete_id: string;
          coach_id: string | null;
          created_at: string;
          day_of_week: number;
          end_minute: number;
          frequency: string;
          id: string;
          start_minute: number;
          starts_on: string | null;
          updated_at: string;
          weeks_of_month: number[];
        };
        Insert: {
          athlete_id: string;
          coach_id?: string | null;
          created_at?: string;
          day_of_week: number;
          end_minute: number;
          frequency?: string;
          id?: string;
          start_minute: number;
          starts_on?: string | null;
          updated_at?: string;
          weeks_of_month?: number[];
        };
        Update: {
          athlete_id?: string;
          coach_id?: string | null;
          created_at?: string;
          day_of_week?: number;
          end_minute?: number;
          frequency?: string;
          id?: string;
          start_minute?: number;
          starts_on?: string | null;
          updated_at?: string;
          weeks_of_month?: number[];
        };
        Relationships: [];
      };
      athlete_primary_coaches: {
        Row: {
          athlete_id: string;
          coach_id: string;
          created_at: string;
          id: string;
          sport: string;
          updated_at: string;
        };
        Insert: {
          athlete_id: string;
          coach_id: string;
          created_at?: string;
          id?: string;
          sport: string;
          updated_at?: string;
        };
        Update: {
          athlete_id?: string;
          coach_id?: string;
          created_at?: string;
          id?: string;
          sport?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "athlete_primary_coaches_athlete_id_fkey";
            columns: ["athlete_id"];
            isOneToOne: false;
            referencedRelation: "athletes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "athlete_primary_coaches_coach_id_fkey";
            columns: ["coach_id"];
            isOneToOne: false;
            referencedRelation: "coach_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      athletes: {
        Row: {
          birthdate: string | null;
          created_at: string;
          first_name: string;
          id: string;
          is_test: boolean;
          last_name: string;
          motivation: string;
          parent_id: string | null;
          promo_code: string | null;
          self_managed: boolean;
          updated_at: string;
          user_id: string | null;
          username: string | null;
        };
        Insert: {
          birthdate?: string | null;
          created_at?: string;
          first_name: string;
          id?: string;
          is_test?: boolean;
          last_name?: string;
          motivation?: string;
          parent_id?: string | null;
          promo_code?: string | null;
          self_managed?: boolean;
          updated_at?: string;
          user_id?: string | null;
          username?: string | null;
        };
        Update: {
          birthdate?: string | null;
          created_at?: string;
          first_name?: string;
          id?: string;
          is_test?: boolean;
          last_name?: string;
          motivation?: string;
          parent_id?: string | null;
          promo_code?: string | null;
          self_managed?: boolean;
          updated_at?: string;
          user_id?: string | null;
          username?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "athletes_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "parent_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "athletes_promo_code_fkey";
            columns: ["promo_code"];
            isOneToOne: false;
            referencedRelation: "promo_codes";
            referencedColumns: ["code"];
          },
        ];
      };
      billing_events: {
        Row: {
          amount_cents: number | null;
          created_at: string;
          currency: string | null;
          environment: string;
          event_type: string;
          id: string;
          payload: Json;
          period_end: string | null;
          period_start: string | null;
          status: string | null;
          stripe_customer_id: string | null;
          stripe_event_id: string;
          stripe_invoice_id: string | null;
          stripe_subscription_id: string | null;
          user_id: string | null;
        };
        Insert: {
          amount_cents?: number | null;
          created_at?: string;
          currency?: string | null;
          environment?: string;
          event_type: string;
          id?: string;
          payload?: Json;
          period_end?: string | null;
          period_start?: string | null;
          status?: string | null;
          stripe_customer_id?: string | null;
          stripe_event_id: string;
          stripe_invoice_id?: string | null;
          stripe_subscription_id?: string | null;
          user_id?: string | null;
        };
        Update: {
          amount_cents?: number | null;
          created_at?: string;
          currency?: string | null;
          environment?: string;
          event_type?: string;
          id?: string;
          payload?: Json;
          period_end?: string | null;
          period_start?: string | null;
          status?: string | null;
          stripe_customer_id?: string | null;
          stripe_event_id?: string;
          stripe_invoice_id?: string | null;
          stripe_subscription_id?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
      client_errors: {
        Row: {
          created_at: string;
          environment: string;
          id: string;
          message: string;
          metadata: Json;
          route: string | null;
          source: string;
          stack: string | null;
          user_agent: string | null;
          user_email: string | null;
          user_id: string | null;
          user_name: string | null;
          user_role: string | null;
        };
        Insert: {
          created_at?: string;
          environment?: string;
          id?: string;
          message: string;
          metadata?: Json;
          route?: string | null;
          source: string;
          stack?: string | null;
          user_agent?: string | null;
          user_email?: string | null;
          user_id?: string | null;
          user_name?: string | null;
          user_role?: string | null;
        };
        Update: {
          created_at?: string;
          environment?: string;
          id?: string;
          message?: string;
          metadata?: Json;
          route?: string | null;
          source?: string;
          stack?: string | null;
          user_agent?: string | null;
          user_email?: string | null;
          user_id?: string | null;
          user_name?: string | null;
          user_role?: string | null;
        };
        Relationships: [];
      };
      coach_athlete_rates: {
        Row: {
          athlete_id: string;
          coach_id: string;
          created_at: string;
          id: string;
          rate_cents: number;
          rate_kind: string;
          updated_at: string;
        };
        Insert: {
          athlete_id: string;
          coach_id: string;
          created_at?: string;
          id?: string;
          rate_cents: number;
          rate_kind: string;
          updated_at?: string;
        };
        Update: {
          athlete_id?: string;
          coach_id?: string;
          created_at?: string;
          id?: string;
          rate_cents?: number;
          rate_kind?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "coach_athlete_rates_athlete_id_fkey";
            columns: ["athlete_id"];
            isOneToOne: false;
            referencedRelation: "athletes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "coach_athlete_rates_coach_id_fkey";
            columns: ["coach_id"];
            isOneToOne: false;
            referencedRelation: "coach_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      coach_athlete_sports: {
        Row: {
          athlete_id: string;
          coach_id: string;
          created_at: string;
          id: string;
          sport: string;
          updated_at: string;
        };
        Insert: {
          athlete_id: string;
          coach_id: string;
          created_at?: string;
          id?: string;
          sport: string;
          updated_at?: string;
        };
        Update: {
          athlete_id?: string;
          coach_id?: string;
          created_at?: string;
          id?: string;
          sport?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "coach_athlete_sports_athlete_id_fkey";
            columns: ["athlete_id"];
            isOneToOne: false;
            referencedRelation: "athletes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "coach_athlete_sports_coach_id_fkey";
            columns: ["coach_id"];
            isOneToOne: false;
            referencedRelation: "coach_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      coach_athletes: {
        Row: {
          athlete_id: string;
          coach_ack_at: string | null;
          coach_id: string;
          created_at: string;
          id: string;
          other_ack_at: string | null;
        };
        Insert: {
          athlete_id: string;
          coach_ack_at?: string | null;
          coach_id: string;
          created_at?: string;
          id?: string;
          other_ack_at?: string | null;
        };
        Update: {
          athlete_id?: string;
          coach_ack_at?: string | null;
          coach_id?: string;
          created_at?: string;
          id?: string;
          other_ack_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "coach_athletes_athlete_id_fkey";
            columns: ["athlete_id"];
            isOneToOne: false;
            referencedRelation: "athletes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "coach_athletes_coach_id_fkey";
            columns: ["coach_id"];
            isOneToOne: false;
            referencedRelation: "coach_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      coach_invite_codes: {
        Row: {
          coach_id: string;
          code: string;
          created_at: string;
          id: string;
          updated_at: string;
        };
        Insert: {
          coach_id: string;
          code: string;
          created_at?: string;
          id?: string;
          updated_at?: string;
        };
        Update: {
          coach_id?: string;
          code?: string;
          created_at?: string;
          id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "coach_invite_codes_coach_id_fkey";
            columns: ["coach_id"];
            isOneToOne: true;
            referencedRelation: "coach_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      coach_levels: {
        Row: {
          coach_id: string;
          created_at: string;
          id: string;
          level_key: string;
          practice_hours_per_week: number;
          sport: string;
          updated_at: string;
        };
        Insert: {
          coach_id: string;
          created_at?: string;
          id?: string;
          level_key: string;
          practice_hours_per_week?: number;
          sport: string;
          updated_at?: string;
        };
        Update: {
          coach_id?: string;
          created_at?: string;
          id?: string;
          level_key?: string;
          practice_hours_per_week?: number;
          sport?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "coach_levels_coach_id_fkey";
            columns: ["coach_id"];
            isOneToOne: false;
            referencedRelation: "coach_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      coach_profiles: {
        Row: {
          created_at: string;
          current_period_end: string | null;
          entitlement: string;
          first_name: string;
          founding_coach: boolean;
          founding_pro_trial_started_at: string | null;
          founding_pro_trial_used: boolean;
          id: string;
          is_org_admin: boolean;
          is_test: boolean;
          last_name: string;
          last_seen_at: string | null;
          last_synced_content_version: number;
          onboarded_at: string | null;
          organization_id: string | null;
          promo_code: string | null;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          subscription_environment: string | null;
          subscription_status: string | null;
          subscription_tier: string | null;
          trial_ends_at: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          current_period_end?: string | null;
          entitlement?: string;
          first_name?: string;
          founding_coach?: boolean;
          founding_pro_trial_started_at?: string | null;
          founding_pro_trial_used?: boolean;
          id?: string;
          is_org_admin?: boolean;
          is_test?: boolean;
          last_name?: string;
          last_seen_at?: string | null;
          last_synced_content_version?: number;
          onboarded_at?: string | null;
          organization_id?: string | null;
          promo_code?: string | null;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          subscription_environment?: string | null;
          subscription_status?: string | null;
          subscription_tier?: string | null;
          trial_ends_at?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          current_period_end?: string | null;
          entitlement?: string;
          first_name?: string;
          founding_coach?: boolean;
          founding_pro_trial_started_at?: string | null;
          founding_pro_trial_used?: boolean;
          id?: string;
          is_org_admin?: boolean;
          is_test?: boolean;
          last_name?: string;
          last_seen_at?: string | null;
          last_synced_content_version?: number;
          onboarded_at?: string | null;
          organization_id?: string | null;
          promo_code?: string | null;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          subscription_environment?: string | null;
          subscription_status?: string | null;
          subscription_tier?: string | null;
          trial_ends_at?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "coach_profiles_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "coach_profiles_promo_code_fkey";
            columns: ["promo_code"];
            isOneToOne: false;
            referencedRelation: "promo_codes";
            referencedColumns: ["code"];
          },
        ];
      };
      direct_rooms: {
        Row: {
          coach_a_id: string | null;
          coach_b_id: string | null;
          coach_id: string | null;
          created_at: string;
          id: string;
          kind: string;
          parent_id: string | null;
          updated_at: string;
          user_a: string;
          user_b: string;
        };
        Insert: {
          coach_a_id?: string | null;
          coach_b_id?: string | null;
          coach_id?: string | null;
          created_at?: string;
          id?: string;
          kind: string;
          parent_id?: string | null;
          updated_at?: string;
          user_a: string;
          user_b: string;
        };
        Update: {
          coach_a_id?: string | null;
          coach_b_id?: string | null;
          coach_id?: string | null;
          created_at?: string;
          id?: string;
          kind?: string;
          parent_id?: string | null;
          updated_at?: string;
          user_a?: string;
          user_b?: string;
        };
        Relationships: [
          {
            foreignKeyName: "direct_rooms_coach_a_id_fkey";
            columns: ["coach_a_id"];
            isOneToOne: false;
            referencedRelation: "coach_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "direct_rooms_coach_b_id_fkey";
            columns: ["coach_b_id"];
            isOneToOne: false;
            referencedRelation: "coach_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "direct_rooms_coach_id_fkey";
            columns: ["coach_id"];
            isOneToOne: false;
            referencedRelation: "coach_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "direct_rooms_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "parent_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      email_send_log: {
        Row: {
          created_at: string;
          error_message: string | null;
          id: string;
          message_id: string | null;
          metadata: Json | null;
          recipient_email: string;
          status: string;
          template_name: string;
        };
        Insert: {
          created_at?: string;
          error_message?: string | null;
          id?: string;
          message_id?: string | null;
          metadata?: Json | null;
          recipient_email: string;
          status: string;
          template_name: string;
        };
        Update: {
          created_at?: string;
          error_message?: string | null;
          id?: string;
          message_id?: string | null;
          metadata?: Json | null;
          recipient_email?: string;
          status?: string;
          template_name?: string;
        };
        Relationships: [];
      };
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number;
          batch_size: number;
          id: number;
          retry_after_until: string | null;
          send_delay_ms: number;
          transactional_email_ttl_minutes: number;
          updated_at: string;
        };
        Insert: {
          auth_email_ttl_minutes?: number;
          batch_size?: number;
          id?: number;
          retry_after_until?: string | null;
          send_delay_ms?: number;
          transactional_email_ttl_minutes?: number;
          updated_at?: string;
        };
        Update: {
          auth_email_ttl_minutes?: number;
          batch_size?: number;
          id?: number;
          retry_after_until?: string | null;
          send_delay_ms?: number;
          transactional_email_ttl_minutes?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      email_template_override_history: {
        Row: {
          action: string;
          changed_at: string;
          changed_by: string | null;
          id: string;
          slot_key: string;
          template_name: string;
          value: string;
        };
        Insert: {
          action: string;
          changed_at?: string;
          changed_by?: string | null;
          id?: string;
          slot_key: string;
          template_name: string;
          value: string;
        };
        Update: {
          action?: string;
          changed_at?: string;
          changed_by?: string | null;
          id?: string;
          slot_key?: string;
          template_name?: string;
          value?: string;
        };
        Relationships: [];
      };
      email_template_overrides: {
        Row: {
          slot_key: string;
          template_name: string;
          updated_at: string;
          updated_by: string | null;
          value: string;
        };
        Insert: {
          slot_key: string;
          template_name: string;
          updated_at?: string;
          updated_by?: string | null;
          value: string;
        };
        Update: {
          slot_key?: string;
          template_name?: string;
          updated_at?: string;
          updated_by?: string | null;
          value?: string;
        };
        Relationships: [];
      };
      email_unsubscribe_tokens: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          token: string;
          used_at: string | null;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          token: string;
          used_at?: string | null;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          token?: string;
          used_at?: string | null;
        };
        Relationships: [];
      };
      error_group_explanations: {
        Row: {
          created_at: string;
          explanation: string;
          id: string;
          model: string | null;
          sample_message: string;
          signature: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          explanation: string;
          id?: string;
          model?: string | null;
          sample_message: string;
          signature: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          explanation?: string;
          id?: string;
          model?: string | null;
          sample_message?: string;
          signature?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      feedback: {
        Row: {
          created_at: string;
          id: string;
          message: string;
          path: string | null;
          resolved_at: string | null;
          role: string;
          user_agent: string | null;
          user_id: string;
          viewport: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          message: string;
          path?: string | null;
          resolved_at?: string | null;
          role: string;
          user_agent?: string | null;
          user_id: string;
          viewport?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          message?: string;
          path?: string | null;
          resolved_at?: string | null;
          role?: string;
          user_agent?: string | null;
          user_id?: string;
          viewport?: string | null;
        };
        Relationships: [];
      };
      invite_lookup_attempts: {
        Row: {
          attempted_at: string;
          code: string | null;
          found: boolean;
          id: string;
          ip: string;
        };
        Insert: {
          attempted_at?: string;
          code?: string | null;
          found?: boolean;
          id?: string;
          ip: string;
        };
        Update: {
          attempted_at?: string;
          code?: string | null;
          found?: boolean;
          id?: string;
          ip?: string;
        };
        Relationships: [];
      };
      invoice_lines: {
        Row: {
          amount_cents: number;
          created_at: string;
          end_minute: number | null;
          id: string;
          included_reason: string;
          invoice_id: string;
          occurrence_date: string;
          slot_id: string | null;
          start_minute: number | null;
        };
        Insert: {
          amount_cents: number;
          created_at?: string;
          end_minute?: number | null;
          id?: string;
          included_reason?: string;
          invoice_id: string;
          occurrence_date: string;
          slot_id?: string | null;
          start_minute?: number | null;
        };
        Update: {
          amount_cents?: number;
          created_at?: string;
          end_minute?: number | null;
          id?: string;
          included_reason?: string;
          invoice_id?: string;
          occurrence_date?: string;
          slot_id?: string | null;
          start_minute?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoice_lines_slot_id_fkey";
            columns: ["slot_id"];
            isOneToOne: false;
            referencedRelation: "athlete_lesson_slots";
            referencedColumns: ["id"];
          },
        ];
      };
      invoices: {
        Row: {
          athlete_id: string;
          coach_id: string;
          created_at: string;
          id: string;
          paid_at: string | null;
          period_end: string;
          period_start: string;
          status: string;
          total_cents: number;
          updated_at: string;
        };
        Insert: {
          athlete_id: string;
          coach_id: string;
          created_at?: string;
          id?: string;
          paid_at?: string | null;
          period_end: string;
          period_start: string;
          status?: string;
          total_cents?: number;
          updated_at?: string;
        };
        Update: {
          athlete_id?: string;
          coach_id?: string;
          created_at?: string;
          id?: string;
          paid_at?: string | null;
          period_end?: string;
          period_start?: string;
          status?: string;
          total_cents?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invoices_athlete_id_fkey";
            columns: ["athlete_id"];
            isOneToOne: false;
            referencedRelation: "athletes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_coach_id_fkey";
            columns: ["coach_id"];
            isOneToOne: false;
            referencedRelation: "coach_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      lesson_slot_overrides: {
        Row: {
          created_at: string;
          end_minute: number | null;
          id: string;
          occurrence_date: string;
          slot_id: string;
          start_minute: number | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          end_minute?: number | null;
          id?: string;
          occurrence_date: string;
          slot_id: string;
          start_minute?: number | null;
          status: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          end_minute?: number | null;
          id?: string;
          occurrence_date?: string;
          slot_id?: string;
          start_minute?: number | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lesson_slot_overrides_slot_id_fkey";
            columns: ["slot_id"];
            isOneToOne: false;
            referencedRelation: "athlete_lesson_slots";
            referencedColumns: ["id"];
          },
        ];
      };
      lesson_wrap_ups: {
        Row: {
          action: string;
          athlete_id: string;
          coach_id: string;
          created_at: string;
          id: string;
          lesson_date: string;
          updated_at: string;
        };
        Insert: {
          action: string;
          athlete_id: string;
          coach_id: string;
          created_at?: string;
          id?: string;
          lesson_date: string;
          updated_at?: string;
        };
        Update: {
          action?: string;
          athlete_id?: string;
          coach_id?: string;
          created_at?: string;
          id?: string;
          lesson_date?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lesson_wrap_ups_athlete_id_fkey";
            columns: ["athlete_id"];
            isOneToOne: false;
            referencedRelation: "athletes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lesson_wrap_ups_coach_id_fkey";
            columns: ["coach_id"];
            isOneToOne: false;
            referencedRelation: "coach_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      message_reads: {
        Row: {
          message_id: string;
          read_at: string;
          user_id: string;
        };
        Insert: {
          message_id: string;
          read_at?: string;
          user_id: string;
        };
        Update: {
          message_id?: string;
          read_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "message_reads_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id"];
          },
        ];
      };
      message_rooms: {
        Row: {
          athlete_id: string;
          coach_id: string;
          created_at: string;
          id: string;
          updated_at: string;
        };
        Insert: {
          athlete_id: string;
          coach_id: string;
          created_at?: string;
          id?: string;
          updated_at?: string;
        };
        Update: {
          athlete_id?: string;
          coach_id?: string;
          created_at?: string;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          audio_url: string | null;
          body: string;
          created_at: string;
          direct_room_id: string | null;
          duration_seconds: number | null;
          id: string;
          kind: string;
          plan_id: string | null;
          room_id: string | null;
          sender_role: string;
          sender_user_id: string;
        };
        Insert: {
          audio_url?: string | null;
          body?: string;
          created_at?: string;
          direct_room_id?: string | null;
          duration_seconds?: number | null;
          id?: string;
          kind: string;
          plan_id?: string | null;
          room_id?: string | null;
          sender_role: string;
          sender_user_id: string;
        };
        Update: {
          audio_url?: string | null;
          body?: string;
          created_at?: string;
          direct_room_id?: string | null;
          duration_seconds?: number | null;
          id?: string;
          kind?: string;
          plan_id?: string | null;
          room_id?: string | null;
          sender_role?: string;
          sender_user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_direct_room_id_fkey";
            columns: ["direct_room_id"];
            isOneToOne: false;
            referencedRelation: "direct_rooms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "message_rooms";
            referencedColumns: ["id"];
          },
        ];
      };
      moves: {
        Row: {
          archived_at: string | null;
          category: string;
          coach_id: string | null;
          created_at: string;
          cue: string;
          default_target_kind: string;
          default_target_value: number;
          description: string;
          id: string;
          is_org_template: boolean;
          name: string;
          organization_id: string | null;
          sport: string;
          updated_at: string;
          why: string;
        };
        Insert: {
          archived_at?: string | null;
          category?: string;
          coach_id?: string | null;
          created_at?: string;
          cue?: string;
          default_target_kind?: string;
          default_target_value?: number;
          description?: string;
          id?: string;
          is_org_template?: boolean;
          name: string;
          organization_id?: string | null;
          sport: string;
          updated_at?: string;
          why?: string;
        };
        Update: {
          archived_at?: string | null;
          category?: string;
          coach_id?: string | null;
          created_at?: string;
          cue?: string;
          default_target_kind?: string;
          default_target_value?: number;
          description?: string;
          id?: string;
          is_org_template?: boolean;
          name?: string;
          organization_id?: string | null;
          sport?: string;
          updated_at?: string;
          why?: string;
        };
        Relationships: [
          {
            foreignKeyName: "moves_coach_id_fkey";
            columns: ["coach_id"];
            isOneToOne: false;
            referencedRelation: "coach_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "moves_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      org_admin_actions: {
        Row: {
          action: string;
          actor_user_id: string;
          created_at: string;
          id: string;
          organization_id: string;
          payload: Json;
          target_coach_id: string | null;
        };
        Insert: {
          action: string;
          actor_user_id: string;
          created_at?: string;
          id?: string;
          organization_id: string;
          payload?: Json;
          target_coach_id?: string | null;
        };
        Update: {
          action?: string;
          actor_user_id?: string;
          created_at?: string;
          id?: string;
          organization_id?: string;
          payload?: Json;
          target_coach_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "org_admin_actions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "org_admin_actions_target_coach_id_fkey";
            columns: ["target_coach_id"];
            isOneToOne: false;
            referencedRelation: "coach_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      org_admins: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          organization_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          organization_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          organization_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "org_admins_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      org_coach_invites: {
        Row: {
          accepted_at: string | null;
          accepted_user_id: string | null;
          created_at: string;
          email: string | null;
          expires_at: string;
          id: string;
          invite_code: string;
          invite_token: string;
          invited_by: string | null;
          organization_id: string;
          phone: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          accepted_at?: string | null;
          accepted_user_id?: string | null;
          created_at?: string;
          email?: string | null;
          expires_at?: string;
          id?: string;
          invite_code: string;
          invite_token: string;
          invited_by?: string | null;
          organization_id: string;
          phone?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          accepted_at?: string | null;
          accepted_user_id?: string | null;
          created_at?: string;
          email?: string | null;
          expires_at?: string;
          id?: string;
          invite_code?: string;
          invite_token?: string;
          invited_by?: string | null;
          organization_id?: string;
          phone?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "org_coach_invites_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_invite_codes: {
        Row: {
          active: boolean;
          code: string;
          created_at: string;
          id: string;
          organization_id: string;
        };
        Insert: {
          active?: boolean;
          code: string;
          created_at?: string;
          id?: string;
          organization_id: string;
        };
        Update: {
          active?: boolean;
          code?: string;
          created_at?: string;
          id?: string;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_invite_codes_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_leads: {
        Row: {
          admin_notes: string | null;
          channel: string;
          coach_email: string;
          coach_user_id: string;
          created_at: string;
          id: string;
          message_body: string;
          requested_org_city: string | null;
          requested_org_name: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          admin_notes?: string | null;
          channel: string;
          coach_email: string;
          coach_user_id: string;
          created_at?: string;
          id?: string;
          message_body: string;
          requested_org_city?: string | null;
          requested_org_name: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          admin_notes?: string | null;
          channel?: string;
          coach_email?: string;
          coach_user_id?: string;
          created_at?: string;
          id?: string;
          message_body?: string;
          requested_org_city?: string | null;
          requested_org_name?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      organizations: {
        Row: {
          active: boolean;
          city: string | null;
          content_version: number;
          created_at: string;
          id: string;
          is_listed: boolean;
          logo_url: string | null;
          name: string;
          notes: string | null;
          region: string | null;
          slug: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          city?: string | null;
          content_version?: number;
          created_at?: string;
          id?: string;
          is_listed?: boolean;
          logo_url?: string | null;
          name: string;
          notes?: string | null;
          region?: string | null;
          slug: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          city?: string | null;
          content_version?: number;
          created_at?: string;
          id?: string;
          is_listed?: boolean;
          logo_url?: string | null;
          name?: string;
          notes?: string | null;
          region?: string | null;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      parent_invite_codes: {
        Row: {
          code: string;
          created_at: string;
          id: string;
          parent_id: string;
          promo_code: string | null;
        };
        Insert: {
          code: string;
          created_at?: string;
          id?: string;
          parent_id: string;
          promo_code?: string | null;
        };
        Update: {
          code?: string;
          created_at?: string;
          id?: string;
          parent_id?: string;
          promo_code?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "parent_invite_codes_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: true;
            referencedRelation: "parent_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "parent_invite_codes_promo_code_fkey";
            columns: ["promo_code"];
            isOneToOne: false;
            referencedRelation: "promo_codes";
            referencedColumns: ["code"];
          },
        ];
      };
      parent_profiles: {
        Row: {
          coach_id: string | null;
          created_at: string;
          first_name: string;
          id: string;
          is_test: boolean;
          last_name: string;
          last_seen_at: string | null;
          promo_code: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          coach_id?: string | null;
          created_at?: string;
          first_name?: string;
          id?: string;
          is_test?: boolean;
          last_name?: string;
          last_seen_at?: string | null;
          promo_code?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          coach_id?: string | null;
          created_at?: string;
          first_name?: string;
          id?: string;
          is_test?: boolean;
          last_name?: string;
          last_seen_at?: string | null;
          promo_code?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "parent_profiles_coach_id_fkey";
            columns: ["coach_id"];
            isOneToOne: false;
            referencedRelation: "coach_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "parent_profiles_promo_code_fkey";
            columns: ["promo_code"];
            isOneToOne: false;
            referencedRelation: "promo_codes";
            referencedColumns: ["code"];
          },
        ];
      };
      parent_saved_answers: {
        Row: {
          answer: string;
          created_at: string;
          id: string;
          question: string;
          sport: string;
          user_id: string;
        };
        Insert: {
          answer: string;
          created_at?: string;
          id?: string;
          question: string;
          sport: string;
          user_id: string;
        };
        Update: {
          answer?: string;
          created_at?: string;
          id?: string;
          question?: string;
          sport?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      plan_moves: {
        Row: {
          created_at: string;
          cue: string;
          description: string;
          id: string;
          move_id: string | null;
          name: string;
          plan_id: string;
          position: number;
          target_kind: string;
          target_value: number;
          why: string;
        };
        Insert: {
          created_at?: string;
          cue?: string;
          description?: string;
          id?: string;
          move_id?: string | null;
          name: string;
          plan_id: string;
          position?: number;
          target_kind: string;
          target_value?: number;
          why?: string;
        };
        Update: {
          created_at?: string;
          cue?: string;
          description?: string;
          id?: string;
          move_id?: string | null;
          name?: string;
          plan_id?: string;
          position?: number;
          target_kind?: string;
          target_value?: number;
          why?: string;
        };
        Relationships: [
          {
            foreignKeyName: "plan_moves_move_id_fkey";
            columns: ["move_id"];
            isOneToOne: false;
            referencedRelation: "moves";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plan_moves_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
        ];
      };
      plan_sessions: {
        Row: {
          athlete_id: string;
          created_at: string;
          duration_seconds: number;
          id: string;
          logged_at: string;
          note: string;
          parent_id: string | null;
          plan_id: string;
          state_index: number;
        };
        Insert: {
          athlete_id: string;
          created_at?: string;
          duration_seconds?: number;
          id?: string;
          logged_at?: string;
          note?: string;
          parent_id?: string | null;
          plan_id: string;
          state_index: number;
        };
        Update: {
          athlete_id?: string;
          created_at?: string;
          duration_seconds?: number;
          id?: string;
          logged_at?: string;
          note?: string;
          parent_id?: string | null;
          plan_id?: string;
          state_index?: number;
        };
        Relationships: [];
      };
      plans: {
        Row: {
          athlete_id: string | null;
          coach_id: string | null;
          created_at: string;
          id: string;
          is_org_template: boolean;
          kind: string;
          notes: string;
          organization_id: string | null;
          share_token: string | null;
          shared_at: string | null;
          status: string;
          title: string;
          updated_at: string;
          voice_transcript: string | null;
        };
        Insert: {
          athlete_id?: string | null;
          coach_id?: string | null;
          created_at?: string;
          id?: string;
          is_org_template?: boolean;
          kind: string;
          notes?: string;
          organization_id?: string | null;
          share_token?: string | null;
          shared_at?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
          voice_transcript?: string | null;
        };
        Update: {
          athlete_id?: string | null;
          coach_id?: string | null;
          created_at?: string;
          id?: string;
          is_org_template?: boolean;
          kind?: string;
          notes?: string;
          organization_id?: string | null;
          share_token?: string | null;
          shared_at?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
          voice_transcript?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "plans_athlete_id_fkey";
            columns: ["athlete_id"];
            isOneToOne: false;
            referencedRelation: "athletes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plans_coach_id_fkey";
            columns: ["coach_id"];
            isOneToOne: false;
            referencedRelation: "coach_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "plans_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      pre_lesson_briefings: {
        Row: {
          athlete_id: string;
          coach_id: string;
          created_at: string;
          generated_at: string;
          id: string;
          lesson_date: string;
          narrative: string;
          source_hash: string;
          updated_at: string;
        };
        Insert: {
          athlete_id: string;
          coach_id: string;
          created_at?: string;
          generated_at?: string;
          id?: string;
          lesson_date: string;
          narrative: string;
          source_hash: string;
          updated_at?: string;
        };
        Update: {
          athlete_id?: string;
          coach_id?: string;
          created_at?: string;
          generated_at?: string;
          id?: string;
          lesson_date?: string;
          narrative?: string;
          source_hash?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pre_lesson_briefings_athlete_id_fkey";
            columns: ["athlete_id"];
            isOneToOne: false;
            referencedRelation: "athletes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pre_lesson_briefings_coach_id_fkey";
            columns: ["coach_id"];
            isOneToOne: false;
            referencedRelation: "coach_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      promo_codes: {
        Row: {
          active: boolean;
          applies_to_plans: string[];
          card_required: boolean;
          code: string;
          created_at: string;
          duration: string;
          duration_in_months: number | null;
          label: string;
          notes: string | null;
          percent_off: number;
          stripe_coupon_id_live: string | null;
          stripe_coupon_id_sandbox: string | null;
          stripe_promo_id_live: string | null;
          stripe_promo_id_sandbox: string | null;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          applies_to_plans?: string[];
          card_required?: boolean;
          code: string;
          created_at?: string;
          duration?: string;
          duration_in_months?: number | null;
          label: string;
          notes?: string | null;
          percent_off?: number;
          stripe_coupon_id_live?: string | null;
          stripe_coupon_id_sandbox?: string | null;
          stripe_promo_id_live?: string | null;
          stripe_promo_id_sandbox?: string | null;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          applies_to_plans?: string[];
          card_required?: boolean;
          code?: string;
          created_at?: string;
          duration?: string;
          duration_in_months?: number | null;
          label?: string;
          notes?: string | null;
          percent_off?: number;
          stripe_coupon_id_live?: string | null;
          stripe_coupon_id_sandbox?: string | null;
          stripe_promo_id_live?: string | null;
          stripe_promo_id_sandbox?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      resource_sports: {
        Row: {
          resource_id: string;
          sport: string;
        };
        Insert: {
          resource_id: string;
          sport: string;
        };
        Update: {
          resource_id?: string;
          sport?: string;
        };
        Relationships: [
          {
            foreignKeyName: "resource_sports_resource_id_fkey";
            columns: ["resource_id"];
            isOneToOne: false;
            referencedRelation: "resources";
            referencedColumns: ["id"];
          },
        ];
      };
      resources: {
        Row: {
          coach_id: string | null;
          created_at: string;
          description: string;
          display_order: number;
          external_url: string | null;
          id: string;
          is_org_template: boolean;
          kind: string;
          organization_id: string | null;
          published: boolean;
          sport: string;
          storage_path: string | null;
          title: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          coach_id?: string | null;
          created_at?: string;
          description?: string;
          display_order?: number;
          external_url?: string | null;
          id?: string;
          is_org_template?: boolean;
          kind?: string;
          organization_id?: string | null;
          published?: boolean;
          sport: string;
          storage_path?: string | null;
          title: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          coach_id?: string | null;
          created_at?: string;
          description?: string;
          display_order?: number;
          external_url?: string | null;
          id?: string;
          is_org_template?: boolean;
          kind?: string;
          organization_id?: string | null;
          published?: boolean;
          sport?: string;
          storage_path?: string | null;
          title?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "resources_coach_id_fkey";
            columns: ["coach_id"];
            isOneToOne: false;
            referencedRelation: "coach_profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "resources_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      seed_moves: {
        Row: {
          category: string;
          created_at: string;
          cue: string;
          default_target_kind: string;
          default_target_value: number;
          description: string;
          id: string;
          name: string;
          sport: string;
          why: string;
        };
        Insert: {
          category: string;
          created_at?: string;
          cue?: string;
          default_target_kind: string;
          default_target_value?: number;
          description?: string;
          id?: string;
          name: string;
          sport: string;
          why?: string;
        };
        Update: {
          category?: string;
          created_at?: string;
          cue?: string;
          default_target_kind?: string;
          default_target_value?: number;
          description?: string;
          id?: string;
          name?: string;
          sport?: string;
          why?: string;
        };
        Relationships: [];
      };
      soft_deleted_users: {
        Row: {
          deleted_at: string;
          deleted_by: string | null;
          reason: string | null;
          user_id: string;
        };
        Insert: {
          deleted_at?: string;
          deleted_by?: string | null;
          reason?: string | null;
          user_id: string;
        };
        Update: {
          deleted_at?: string;
          deleted_by?: string | null;
          reason?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      suppressed_emails: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          metadata: Json | null;
          reason: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          metadata?: Json | null;
          reason: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          metadata?: Json | null;
          reason?: string;
        };
        Relationships: [];
      };
      terms_acceptances: {
        Row: {
          accepted_at: string;
          id: string;
          ip: string | null;
          role: string;
          terms_version: string;
          user_agent: string | null;
          user_id: string;
        };
        Insert: {
          accepted_at?: string;
          id?: string;
          ip?: string | null;
          role: string;
          terms_version: string;
          user_agent?: string | null;
          user_id: string;
        };
        Update: {
          accepted_at?: string;
          id?: string;
          ip?: string | null;
          role?: string;
          terms_version?: string;
          user_agent?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      user_applied_promo_codes: {
        Row: {
          applied_by: string | null;
          code: string;
          created_at: string;
          environment: string | null;
          id: string;
          scope: string;
          stripe_subscription_id: string | null;
          user_id: string;
        };
        Insert: {
          applied_by?: string | null;
          code: string;
          created_at?: string;
          environment?: string | null;
          id?: string;
          scope: string;
          stripe_subscription_id?: string | null;
          user_id: string;
        };
        Update: {
          applied_by?: string | null;
          code?: string;
          created_at?: string;
          environment?: string | null;
          id?: string;
          scope?: string;
          stripe_subscription_id?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_applied_promo_codes_code_fkey";
            columns: ["code"];
            isOneToOne: false;
            referencedRelation: "promo_codes";
            referencedColumns: ["code"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      activate_plan: { Args: { _plan_id: string }; Returns: undefined };
      athlete_has_coach_upload: {
        Args: { _resource_id: string };
        Returns: boolean;
      };
      athlete_has_sport: { Args: { _sport: string }; Returns: boolean };
      caller_is_resource_owner: {
        Args: { _coach_id: string };
        Returns: boolean;
      };
      caller_owns_coach: { Args: { _coach_id: string }; Returns: boolean };
      coach_effective_tier: { Args: { _coach_id: string }; Returns: string };
      coach_has_rostered_athlete_of_parent: {
        Args: { _parent_id: string };
        Returns: boolean;
      };
      delete_email: {
        Args: { message_id: number; queue_name: string };
        Returns: boolean;
      };
      email_queue_dispatch: { Args: never; Returns: undefined };
      enqueue_email: {
        Args: { payload: Json; queue_name: string };
        Returns: number;
      };
      get_adult_athlete_by_invite_code: {
        Args: { _code: string };
        Returns: {
          athlete_id: string;
          first_name: string;
          last_name: string;
        }[];
      };
      get_parent_by_invite_code: {
        Args: { _code: string };
        Returns: {
          athlete_count: number;
          first_name: string;
          last_name: string;
          parent_id: string;
        }[];
      };
      get_shared_plan: { Args: { _token: string }; Returns: Json };
      has_org_admin: {
        Args: { _org_id: string; _user_id: string };
        Returns: boolean;
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      import_shared_plan: { Args: { _token: string }; Returns: string };
      is_any_org_admin: { Args: { _user_id: string }; Returns: boolean };
      is_direct_room_participant: {
        Args: { _direct_room_id: string; _user_id: string };
        Returns: boolean;
      };
      is_parent_of_athlete: { Args: { _athlete_id: string }; Returns: boolean };
      is_parent_of_plan: { Args: { _plan_id: string }; Returns: boolean };
      is_room_participant: {
        Args: { _room_id: string; _user_id: string };
        Returns: boolean;
      };
      is_self_managed_athlete: {
        Args: { _athlete_id: string };
        Returns: boolean;
      };
      move_to_dlq: {
        Args: {
          dlq_name: string;
          message_id: number;
          payload: Json;
          source_queue: string;
        };
        Returns: number;
      };
      parent_has_athlete_in_sport: {
        Args: { _sport: string };
        Returns: boolean;
      };
      parent_has_coach_upload: {
        Args: { _resource_id: string };
        Returns: boolean;
      };
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number };
        Returns: {
          message: Json;
          msg_id: number;
          read_ct: number;
        }[];
      };
      record_invite_lookup_attempt: {
        Args: {
          _code: string;
          _ip: string;
          _max_per_window: number;
          _window_seconds: number;
        };
        Returns: number;
      };
      seed_coach_library: { Args: { _coach_id: string }; Returns: number };
      touch_last_seen: { Args: never; Returns: undefined };
    };
    Enums: {
      app_role: "admin";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin"],
    },
  },
} as const;
