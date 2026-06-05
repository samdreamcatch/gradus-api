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
      athlete_goals: {
        Row: {
          athlete_id: string
          coach_id: string
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
          coach_id: string
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
          coach_id?: string
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
      athlete_invite_codes: {
        Row: {
          athlete_id: string
          claimed_at: string | null
          claimed_by: string | null
          code: string
          created_at: string
          expires_at: string
          id: string
          parent_id: string
          updated_at: string
          used_at: string | null
        }
        Insert: {
          athlete_id: string
          claimed_at?: string | null
          claimed_by?: string | null
          code: string
          created_at?: string
          expires_at?: string
          id?: string
          parent_id: string
          updated_at?: string
          used_at?: string | null
        }
        Update: {
          athlete_id?: string
          claimed_at?: string | null
          claimed_by?: string | null
          code?: string
          created_at?: string
          expires_at?: string
          id?: string
          parent_id?: string
          updated_at?: string
          used_at?: string | null
        }
        Relationships: []
      }
      athlete_lesson_slots: {
        Row: {
          athlete_id: string
          coach_id: string
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
          coach_id: string
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
          coach_id?: string
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
      athletes: {
        Row: {
          birthdate: string | null
          created_at: string
          first_name: string
          id: string
          last_name: string
          motivation: string
          parent_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          birthdate?: string | null
          created_at?: string
          first_name: string
          id?: string
          last_name?: string
          motivation?: string
          parent_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          birthdate?: string | null
          created_at?: string
          first_name?: string
          id?: string
          last_name?: string
          motivation?: string
          parent_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "athletes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "parent_profiles"
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
          coach_id: string
          created_at: string
          id: string
        }
        Insert: {
          athlete_id: string
          coach_id: string
          created_at?: string
          id?: string
        }
        Update: {
          athlete_id?: string
          coach_id?: string
          created_at?: string
          id?: string
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
          first_name: string
          id: string
          last_name: string
          onboarded_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          first_name?: string
          id?: string
          last_name?: string
          onboarded_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          first_name?: string
          id?: string
          last_name?: string
          onboarded_at?: string | null
          updated_at?: string
          user_id?: string
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
          duration_seconds: number | null
          id: string
          kind: string
          plan_id: string | null
          room_id: string
          sender_role: string
          sender_user_id: string
        }
        Insert: {
          audio_url?: string | null
          body?: string
          created_at?: string
          duration_seconds?: number | null
          id?: string
          kind: string
          plan_id?: string | null
          room_id: string
          sender_role: string
          sender_user_id: string
        }
        Update: {
          audio_url?: string | null
          body?: string
          created_at?: string
          duration_seconds?: number | null
          id?: string
          kind?: string
          plan_id?: string | null
          room_id?: string
          sender_role?: string
          sender_user_id?: string
        }
        Relationships: [
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
          coach_id: string
          created_at: string
          cue: string
          default_target_kind: string
          default_target_value: number
          description: string
          id: string
          name: string
          sport: string
          updated_at: string
          why: string
        }
        Insert: {
          archived_at?: string | null
          category?: string
          coach_id: string
          created_at?: string
          cue?: string
          default_target_kind?: string
          default_target_value?: number
          description?: string
          id?: string
          name: string
          sport: string
          updated_at?: string
          why?: string
        }
        Update: {
          archived_at?: string | null
          category?: string
          coach_id?: string
          created_at?: string
          cue?: string
          default_target_kind?: string
          default_target_value?: number
          description?: string
          id?: string
          name?: string
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
        ]
      }
      parent_profiles: {
        Row: {
          coach_id: string | null
          created_at: string
          first_name: string
          id: string
          last_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          coach_id?: string | null
          created_at?: string
          first_name?: string
          id?: string
          last_name?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          coach_id?: string | null
          created_at?: string
          first_name?: string
          id?: string
          last_name?: string
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
        ]
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
          coach_id: string
          created_at: string
          id: string
          kind: string
          notes: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          athlete_id?: string | null
          coach_id: string
          created_at?: string
          id?: string
          kind: string
          notes?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Update: {
          athlete_id?: string | null
          coach_id?: string
          created_at?: string
          id?: string
          kind?: string
          notes?: string
          status?: string
          title?: string
          updated_at?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      activate_plan: { Args: { _plan_id: string }; Returns: undefined }
      coach_has_rostered_athlete_of_parent: {
        Args: { _parent_id: string }
        Returns: boolean
      }
      is_parent_of_athlete: { Args: { _athlete_id: string }; Returns: boolean }
      is_parent_of_plan: { Args: { _plan_id: string }; Returns: boolean }
      is_room_participant: {
        Args: { _room_id: string; _user_id: string }
        Returns: boolean
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
      seed_coach_library: { Args: { _coach_id: string }; Returns: number }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
