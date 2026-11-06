// Pre-seeded sport catalog. `key` values are stored in the database and must
// never change. `label` is display-only and can be edited freely.

export type SportKey =
  | "tennis"
  | "golf"
  | "figure_skating"
  | "dance"
  | "gymnastics"
  | "fencing"
  | "equestrian"
  | "swimming"
  | "track_field"
  | "wrestling"
  | "skiing"
  | "baseball"
  | "softball"
  | "basketball"
  | "soccer"
  | "football"
  | "volleyball"
  | "hockey"
  | "lacrosse"
  | "field_hockey"
  | "water_polo"
  | "rugby"
  | "strength_conditioning";

export interface SportLevel {
  key: string;
  label: string;
  hint?: string;
  /**
   * Rough estimate of weekly solo-practice hours typical for an athlete at
   * this level (outside of formal lessons). Used to pre-populate the
   * onboarding hours step. Sources: USTA player development guidelines,
   * USGA/PGA practice norms, U.S. Figure Skating test-track training loads,
   * and standard pre-professional dance training schedules.
   */
  suggestedHours: number;
}

export interface Sport {
  key: SportKey;
  label: string;
  standard: string;
  levels: SportLevel[];
}

export const SPORTS: Sport[] = [
  {
    key: "tennis",
    label: "Tennis",
    standard: "USTA NTRP",
    levels: [
      { key: "ntrp_1_0", label: "NTRP 1.0", hint: "Just starting", suggestedHours: 1 },
      { key: "ntrp_1_5", label: "NTRP 1.5", suggestedHours: 1 },
      { key: "ntrp_2_0", label: "NTRP 2.0", suggestedHours: 1.5 },
      { key: "ntrp_2_5", label: "NTRP 2.5", suggestedHours: 2 },
      { key: "ntrp_3_0", label: "NTRP 3.0", suggestedHours: 3 },
      { key: "ntrp_3_5", label: "NTRP 3.5", suggestedHours: 4 },
      { key: "ntrp_4_0", label: "NTRP 4.0", suggestedHours: 5 },
      { key: "ntrp_4_5", label: "NTRP 4.5", suggestedHours: 7 },
      { key: "ntrp_5_0", label: "NTRP 5.0", suggestedHours: 10 },
      { key: "ntrp_5_5", label: "NTRP 5.5", suggestedHours: 12 },
      { key: "ntrp_6_0", label: "NTRP 6.0", suggestedHours: 15 },
      { key: "ntrp_7_0", label: "NTRP 7.0", hint: "World-class", suggestedHours: 20 },
    ],
  },
  {
    key: "golf",
    label: "Golf",
    standard: "USGA handicap brackets",
    levels: [
      { key: "beginner", label: "Beginner", hint: "No handicap yet", suggestedHours: 1 },
      { key: "high_handicap", label: "High handicap", hint: "19+", suggestedHours: 2 },
      { key: "mid_handicap", label: "Mid handicap", hint: "10–18", suggestedHours: 4 },
      { key: "low_handicap", label: "Low handicap", hint: "1–9", suggestedHours: 6 },
      { key: "scratch", label: "Scratch", hint: "0 or better", suggestedHours: 10 },
    ],
  },
  {
    key: "figure_skating",
    label: "Figure Skating",
    standard: "U.S. Figure Skating test track",
    levels: [
      { key: "basic_skills", label: "Basic Skills", suggestedHours: 2 },
      { key: "pre_preliminary", label: "Pre-Preliminary", suggestedHours: 3 },
      { key: "preliminary", label: "Preliminary", suggestedHours: 4 },
      { key: "pre_juvenile", label: "Pre-Juvenile", suggestedHours: 6 },
      { key: "juvenile", label: "Juvenile", suggestedHours: 8 },
      { key: "intermediate", label: "Intermediate", suggestedHours: 10 },
      { key: "novice", label: "Novice", suggestedHours: 14 },
      { key: "junior", label: "Junior", suggestedHours: 18 },
      { key: "senior", label: "Senior", suggestedHours: 22 },
    ],
  },
  {
    key: "dance",
    label: "Dance",
    standard: "",
    levels: [
      { key: "beginner", label: "Beginner", suggestedHours: 2 },
      { key: "advanced_beginner", label: "Advanced Beginner", suggestedHours: 4 },
      { key: "intermediate", label: "Intermediate", suggestedHours: 6 },
      { key: "advanced", label: "Advanced", suggestedHours: 10 },
      { key: "pre_professional", label: "Pre-Professional", suggestedHours: 16 },
    ],
  },
  {
    key: "gymnastics",
    label: "Gymnastics",
    standard: "USA Gymnastics Development Program",
    levels: [
      { key: "level_1", label: "Level 1", suggestedHours: 2 },
      { key: "level_2", label: "Level 2", suggestedHours: 3 },
      { key: "level_3", label: "Level 3", suggestedHours: 4 },
      { key: "level_4", label: "Level 4", suggestedHours: 8 },
      { key: "level_5", label: "Level 5", suggestedHours: 12 },
      { key: "level_6", label: "Level 6", suggestedHours: 16 },
      { key: "level_7", label: "Level 7", suggestedHours: 20 },
      { key: "level_8", label: "Level 8", suggestedHours: 22 },
      { key: "level_9", label: "Level 9", suggestedHours: 24 },
      { key: "level_10", label: "Level 10", suggestedHours: 28 },
      { key: "elite", label: "Elite", suggestedHours: 32 },
    ],
  },
  {
    key: "fencing",
    label: "Fencing",
    standard: "USA Fencing Ratings",
    levels: [
      { key: "u", label: "U (Unrated)", suggestedHours: 2 },
      { key: "e", label: "E", suggestedHours: 4 },
      { key: "d", label: "D", suggestedHours: 8 },
      { key: "c", label: "C", suggestedHours: 12 },
      { key: "b", label: "B", suggestedHours: 16 },
      { key: "a", label: "A", suggestedHours: 20 },
    ],
  },
  {
    key: "equestrian",
    label: "Equestrian",
    standard: "",
    levels: [
      { key: "beginner", label: "Beginner", suggestedHours: 2 },
      { key: "advanced_beginner", label: "Advanced Beginner", suggestedHours: 4 },
      { key: "intermediate", label: "Intermediate", suggestedHours: 6 },
      { key: "advanced", label: "Advanced", suggestedHours: 10 },
      { key: "pre_professional", label: "Pre-Professional", suggestedHours: 16 },
    ],
  },
  {
    key: "swimming",
    label: "Swimming",
    standard: "USA Swimming Motivational Time Standards",
    levels: [
      { key: "b", label: "B", suggestedHours: 3 },
      { key: "bb", label: "BB", suggestedHours: 5 },
      { key: "a", label: "A", suggestedHours: 8 },
      { key: "aa", label: "AA", suggestedHours: 12 },
      { key: "aaa", label: "AAA", suggestedHours: 16 },
      { key: "aaaa", label: "AAAA", suggestedHours: 20 },
    ],
  },
  {
    key: "track_field",
    label: "Track & Field",
    standard: "",
    levels: [
      { key: "youth", label: "Youth", suggestedHours: 3 },
      { key: "high_school", label: "High School", suggestedHours: 6 },
      { key: "collegiate", label: "Collegiate", suggestedHours: 12 },
      { key: "elite", label: "Elite", suggestedHours: 18 },
      { key: "professional", label: "Professional", suggestedHours: 22 },
    ],
  },
  {
    key: "wrestling",
    label: "Wrestling",
    standard: "USA Wrestling",
    levels: [
      { key: "beginner", label: "Beginner", suggestedHours: 3 },
      { key: "folkstyle_club", label: "Folkstyle Club", suggestedHours: 6 },
      { key: "state_qualifier", label: "State Qualifier", suggestedHours: 12 },
      { key: "national_qualifier", label: "National Qualifier", suggestedHours: 18 },
      { key: "all_american", label: "All-American", suggestedHours: 22 },
    ],
  },
  {
    key: "skiing",
    label: "Skiing",
    standard: "",
    levels: [
      { key: "beginner", label: "Beginner", suggestedHours: 2 },
      { key: "advanced_beginner", label: "Advanced Beginner", suggestedHours: 4 },
      { key: "intermediate", label: "Intermediate", suggestedHours: 6 },
      { key: "advanced", label: "Advanced", suggestedHours: 10 },
      { key: "pre_professional", label: "Pre-Professional", suggestedHours: 16 },
    ],
  },
  {
    key: "baseball",
    label: "Baseball",
    standard: "Little League / USA Baseball age divisions",
    levels: [
      {
        key: "tee_ball",
        label: "Tee Ball",
        hint: "Ages 4–6, hitting off a tee, no pitching",
        suggestedHours: 1,
      },
      {
        key: "coach_pitch",
        label: "Coach Pitch",
        hint: "Ages 6–8, a coach pitches, outs and bases begin",
        suggestedHours: 1,
      },
      {
        key: "minors",
        label: "Minors",
        hint: "Ages 8–10, kids start pitching, 46-foot mound",
        suggestedHours: 2,
      },
      {
        key: "majors",
        label: "Majors",
        hint: "Ages 10–12, full Little League rules, 60-foot bases",
        suggestedHours: 3,
      },
      {
        key: "intermediate_13u",
        label: "Intermediate / 13U",
        hint: "Ages 12–13, 50-foot mound and 70-foot bases, leading off begins",
        suggestedHours: 3,
      },
      {
        key: "junior_14u",
        label: "Junior / 14U",
        hint: "Ages 13–14, full-size field (60 ft 6 in and 90-foot bases)",
        suggestedHours: 4,
      },
      {
        key: "senior_16u",
        label: "Senior / 16U",
        hint: "Ages 15–16, full-size field, travel and showcase play",
        suggestedHours: 5,
      },
      {
        key: "high_school",
        label: "High school",
        hint: "JV and varsity, spring season plus summer ball",
        suggestedHours: 6,
      },
      {
        key: "college_prospect",
        label: "College prospect",
        hint: "Ages 16–18, showcases, recruiting, year-round training",
        suggestedHours: 8,
      },
    ],
  },
  {
    key: "softball",
    label: "Softball",
    standard: "USA Softball / Little League fastpitch age divisions",
    levels: [
      {
        key: "6u_tee_ball",
        label: "6U Tee Ball",
        hint: "Ages 5–6, hitting off a tee",
        suggestedHours: 1,
      },
      {
        key: "8u_coach_pitch",
        label: "8U Coach Pitch",
        hint: "Ages 7–8, coaches pitch to their own team",
        suggestedHours: 1,
      },
      {
        key: "10u",
        label: "10U",
        hint: "Ages 9–10, player pitching begins at 35 ft with an 11-inch ball",
        suggestedHours: 2,
      },
      {
        key: "12u",
        label: "12U",
        hint: "Ages 11–12, 12-inch ball, 40 ft pitching, full rules",
        suggestedHours: 3,
      },
      {
        key: "14u",
        label: "14U",
        hint: "Ages 13–14, 43 ft pitching, position specialization",
        suggestedHours: 4,
      },
      { key: "16u", label: "16U", hint: "Ages 15–16, showcase travel ball", suggestedHours: 5 },
      { key: "18u", label: "18U", hint: "Ages 17–18, top travel and club ball", suggestedHours: 6 },
      {
        key: "high_school_varsity",
        label: "High school varsity",
        hint: "School team, spring season",
        suggestedHours: 6,
      },
      {
        key: "college_prospect",
        label: "College prospect",
        hint: "Actively recruiting: video, camps, showcases",
        suggestedHours: 8,
      },
    ],
  },
  {
    key: "basketball",
    label: "Basketball",
    standard: "USA Basketball / Jr. NBA youth guidelines by age segment",
    levels: [
      {
        key: "ages_7_8",
        label: "Ages 7–8",
        hint: "Intro: 8-foot rim, size 5 ball, learning the basics",
        suggestedHours: 1,
      },
      {
        key: "ages_9_11",
        label: "Ages 9–11",
        hint: "Rec and school teams: 9-foot rim, size 5 or 6 ball",
        suggestedHours: 2,
      },
      {
        key: "ages_12_14",
        label: "Ages 12–14",
        hint: "Middle school: 10-foot rim, size 6 (girls) or 7 (boys 14+)",
        suggestedHours: 3,
      },
      {
        key: "hs_jv",
        label: "High School JV",
        hint: "Junior varsity, usually grades 9–10",
        suggestedHours: 4,
      },
      {
        key: "hs_varsity",
        label: "High School Varsity",
        hint: "Top high school team, grades 10–12",
        suggestedHours: 5,
      },
      {
        key: "aau_club",
        label: "AAU / Club",
        hint: "Travel and tournament teams outside the school season",
        suggestedHours: 6,
      },
      {
        key: "college_prospect",
        label: "College Prospect",
        hint: "Recruitable player training for the next level",
        suggestedHours: 8,
      },
    ],
  },
  {
    key: "soccer",
    label: "Soccer",
    standard: "US Youth Soccer / US Soccer player development age groups",
    levels: [
      { key: "u6", label: "U6", hint: "Ages 4–5, 4v4, no goalkeeper", suggestedHours: 1 },
      { key: "u8", label: "U8", hint: "Ages 6–7, 4v4", suggestedHours: 1 },
      { key: "u10", label: "U10", hint: "Ages 8–9, 7v7, no heading", suggestedHours: 2 },
      { key: "u12", label: "U12", hint: "Ages 10–11, 9v9, offside starts", suggestedHours: 3 },
      { key: "u14", label: "U14", hint: "Ages 12–13, first 11v11", suggestedHours: 3 },
      { key: "u16", label: "U16", hint: "Ages 14–15, competitive club", suggestedHours: 4 },
      {
        key: "high_school",
        label: "High school",
        hint: "JV / varsity, grades 9–12",
        suggestedHours: 4,
      },
      {
        key: "u19",
        label: "U19",
        hint: "Ages 16–18, college-recruiting window",
        suggestedHours: 5,
      },
      {
        key: "club_academy",
        label: "Club / academy",
        hint: "MLS NEXT, ECNL, Girls Academy and other national leagues",
        suggestedHours: 6,
      },
    ],
  },
  {
    key: "football",
    label: "Football",
    standard:
      "USA Football / Pop Warner age progression (flag first, then tackle by age group, then high school and college prospect)",
    levels: [
      {
        key: "flag_6u_8u",
        label: "Flag 6U–8U",
        hint: "Ages 5–8, flag only, learning the game",
        suggestedHours: 1,
      },
      {
        key: "flag_10u",
        label: "Flag 10U",
        hint: "Ages 9–10, flag, routes and positions",
        suggestedHours: 2,
      },
      {
        key: "tackle_10u",
        label: "Tackle 10U",
        hint: "Ages 9–10, first padded season, Heads Up technique",
        suggestedHours: 2,
      },
      {
        key: "tackle_12u",
        label: "12U",
        hint: "Ages 11–12, full positions and playbooks",
        suggestedHours: 3,
      },
      {
        key: "tackle_14u",
        label: "14U",
        hint: "Ages 13–14, middle school and youth league",
        suggestedHours: 3,
      },
      {
        key: "hs_freshman_jv",
        label: "HS Freshman/JV",
        hint: "Grades 9–10, school program",
        suggestedHours: 4,
      },
      {
        key: "hs_varsity",
        label: "Varsity",
        hint: "Grades 10–12, top school team",
        suggestedHours: 5,
      },
      {
        key: "college_prospect",
        label: "College prospect",
        hint: "Varsity players being recruited",
        suggestedHours: 6,
      },
    ],
  },
  {
    key: "volleyball",
    label: "Volleyball",
    standard: "USA Volleyball age divisions, plus high school and club",
    levels: [
      {
        key: "10u",
        label: "10U",
        hint: "Ages 10 and under, intro; lighter ball, lower net",
        suggestedHours: 1,
      },
      { key: "12u", label: "12U", hint: "Ages 11–12, full six-on-six", suggestedHours: 2 },
      { key: "13u", label: "13U", hint: "Age 13, positions begin", suggestedHours: 2 },
      {
        key: "14u",
        label: "14U",
        hint: "Age 14, specialized positions and serve-receive patterns",
        suggestedHours: 3,
      },
      {
        key: "15u",
        label: "15U",
        hint: "Age 15, jump serves and quick offense",
        suggestedHours: 3,
      },
      {
        key: "hs_jv",
        label: "High school JV",
        hint: "Grades 9–10, developmental school team",
        suggestedHours: 3,
      },
      { key: "16u", label: "16U", hint: "Age 16, varsity-speed club play", suggestedHours: 4 },
      {
        key: "17u_18u",
        label: "17U/18U",
        hint: "Ages 17–18, top club divisions",
        suggestedHours: 4,
      },
      {
        key: "varsity_club",
        label: "Varsity / Club",
        hint: "Varsity school team or national-level club",
        suggestedHours: 5,
      },
    ],
  },
  {
    key: "hockey",
    label: "Hockey",
    standard: "USA Hockey age classifications",
    levels: [
      { key: "8u", label: "8U (Mite)", hint: "Ages 7–8, cross-ice games", suggestedHours: 2 },
      {
        key: "10u",
        label: "10U (Squirt)",
        hint: "Ages 9–10, first full-ice season",
        suggestedHours: 3,
      },
      {
        key: "12u",
        label: "12U (Peewee)",
        hint: "Ages 11–12, body contact taught, no checking",
        suggestedHours: 4,
      },
      {
        key: "14u",
        label: "14U (Bantam)",
        hint: "Ages 13–14, body checking begins",
        suggestedHours: 5,
      },
      { key: "16u", label: "16U (Midget Minor)", hint: "Ages 15–16", suggestedHours: 6 },
      {
        key: "high_school",
        label: "High school",
        hint: "JV and varsity, alongside or instead of 16U/18U",
        suggestedHours: 6,
      },
      {
        key: "18u",
        label: "18U (Midget Major)",
        hint: "Ages 17–18, last youth level",
        suggestedHours: 7,
      },
      {
        key: "junior_prospect",
        label: "Junior / prospect",
        hint: "Ages 16–20, junior leagues feeding college and pro",
        suggestedHours: 8,
      },
    ],
  },
  {
    key: "lacrosse",
    label: "Lacrosse",
    standard: "USA Lacrosse age segments",
    levels: [
      {
        key: "6u",
        label: "6U",
        hint: "Ages 5–6, intro, soft ball and small sticks",
        suggestedHours: 1,
      },
      { key: "8u", label: "8U", hint: "Ages 7–8, small-sided, no checking", suggestedHours: 1 },
      {
        key: "10u",
        label: "10U",
        hint: "Ages 9–10, full field skills, very limited checking",
        suggestedHours: 2,
      },
      { key: "12u", label: "12U", hint: "Ages 11–12, modified checking", suggestedHours: 3 },
      { key: "14u", label: "14U", hint: "Ages 13–14, full youth rules", suggestedHours: 4 },
      {
        key: "hs_jv",
        label: "High School JV",
        hint: "Grades 9–10, developing varsity skills",
        suggestedHours: 5,
      },
      {
        key: "hs_varsity",
        label: "Varsity",
        hint: "High school starting lineup level",
        suggestedHours: 6,
      },
      {
        key: "club_elite",
        label: "Club/Elite",
        hint: "Travel and showcase teams, college recruiting",
        suggestedHours: 8,
      },
    ],
  },
  {
    key: "field_hockey",
    label: "Field Hockey",
    standard: "USA Field Hockey age groups",
    levels: [
      { key: "u8", label: "U8", hint: "Ages 7 and under, intro", suggestedHours: 1 },
      { key: "u10", label: "U10", hint: "Ages 9 and under, small-sided", suggestedHours: 1 },
      { key: "u12", label: "U12", hint: "Ages 11 and under, full rules begin", suggestedHours: 2 },
      { key: "u14", label: "U14", hint: "Ages 13 and under, 11v11", suggestedHours: 3 },
      {
        key: "hs_jv",
        label: "High school JV",
        hint: "Fall school season, junior varsity",
        suggestedHours: 3,
      },
      { key: "u16", label: "U16", hint: "Ages 15 and under, regional club", suggestedHours: 4 },
      { key: "u19", label: "U19", hint: "Ages 18 and under, national club", suggestedHours: 5 },
      {
        key: "hs_varsity",
        label: "High school varsity",
        hint: "Fall school season, varsity",
        suggestedHours: 5,
      },
      {
        key: "club_futures",
        label: "Club / Futures",
        hint: "Year-round club and USA Field Hockey Futures pathway",
        suggestedHours: 6,
      },
    ],
  },
  {
    key: "water_polo",
    label: "Water Polo",
    standard: "USA Water Polo age groups",
    levels: [
      {
        key: "10u_splashball",
        label: "10U Splashball",
        hint: "Ages 10 and under, intro program",
        suggestedHours: 1,
      },
      { key: "12u", label: "12U", hint: "Ages 11–12, first full-rules play", suggestedHours: 2 },
      {
        key: "14u",
        label: "14U",
        hint: "Ages 13–14, positions and travel begin",
        suggestedHours: 3,
      },
      { key: "16u", label: "16U", hint: "Ages 15–16, full-speed club", suggestedHours: 4 },
      {
        key: "hs_jv",
        label: "High school JV",
        hint: "Junior varsity school team",
        suggestedHours: 4,
      },
      { key: "18u", label: "18U", hint: "Ages 17–18, top youth group", suggestedHours: 5 },
      {
        key: "hs_varsity",
        label: "High school varsity",
        hint: "School top team",
        suggestedHours: 5,
      },
      {
        key: "club_odp",
        label: "Club / ODP",
        hint: "Year-round club and Olympic Development Program",
        suggestedHours: 6,
      },
    ],
  },
  {
    key: "rugby",
    label: "Rugby",
    standard: "USA Rugby youth pathway (Rookie Rugby flag through club/academy)",
    levels: [
      {
        key: "rookie_u8",
        label: "Rookie Rugby (U6–U8)",
        hint: "Ages 5–8, flag rugby, no contact",
        suggestedHours: 1,
      },
      { key: "u10", label: "U10", hint: "Ages 8–10, touch or flag", suggestedHours: 1 },
      {
        key: "u12",
        label: "U12",
        hint: "Ages 10–12, intro to tackle in some clubs",
        suggestedHours: 2,
      },
      {
        key: "u14",
        label: "U14",
        hint: "Ages 12–14, full tackle with modified laws",
        suggestedHours: 2,
      },
      { key: "u16", label: "U16", hint: "Ages 14–16, sevens and fifteens", suggestedHours: 3 },
      { key: "u18", label: "U18", hint: "Ages 16–18, full laws", suggestedHours: 4 },
      {
        key: "high_school",
        label: "High school",
        hint: "School-based teams, varsity and JV",
        suggestedHours: 4,
      },
      {
        key: "club_academy",
        label: "Club / academy",
        hint: "Select-side, academy, and pathway programs",
        suggestedHours: 6,
      },
    ],
  },
  {
    key: "strength_conditioning",
    label: "Strength & Conditioning",
    standard: "",
    levels: [
      {
        key: "general_fitness",
        label: "General fitness",
        hint: "Health, longevity, no sport goal",
        suggestedHours: 2,
      },
      {
        key: "in_season_maintenance",
        label: "Sport prep · in-season",
        hint: "Maintain during competition",
        suggestedHours: 3,
      },
      {
        key: "off_season_build",
        label: "Sport prep · off-season",
        hint: "Build strength between seasons",
        suggestedHours: 5,
      },
      {
        key: "performance_athlete",
        label: "Performance athlete",
        hint: "Competitive, structured programming",
        suggestedHours: 8,
      },
      {
        key: "elite_performance",
        label: "Elite performance",
        hint: "Collegiate / pro / national team",
        suggestedHours: 12,
      },
    ],
  },
];

export const SPORT_KEYS: SportKey[] = SPORTS.map((s) => s.key);

/** Fallback for custom sports / custom levels with no curated estimate. */
export const DEFAULT_SUGGESTED_HOURS = 3;

export function getSport(key: string): Sport | undefined {
  return SPORTS.find((s) => s.key === key);
}

/**
 * A sport key as people read it. Custom keys are `custom_<slug>_<suffix>`,
 * and the five-character suffix only keeps keys unique, so it never shows
 * (beta feedback 2026-10-07: "custom_new_sport_c715f" on the roster filter).
 */
export function sportDisplayLabel(key: string): string {
  const builtIn = getSport(key);
  if (builtIn) return builtIn.label;
  if (!key.startsWith("custom_")) return key;
  const slug = key.slice("custom_".length).replace(/_[a-z0-9]{5}$/, "");
  const label = slug
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
  return label || key;
}

/**
 * A built-in sport key, or a custom one as onboarding made them before
 * #206: `custom_` and the slug's lower-case letters, digits and underscores.
 */
export function isSportKey(key: string): boolean {
  return getSport(key) !== undefined || /^custom_[a-z0-9_]+$/.test(key);
}

export function getSportLevel(sportKey: string, levelKey: string): SportLevel | undefined {
  return getSport(sportKey)?.levels.find((l) => l.key === levelKey);
}

export function getSuggestedHours(sportKey: string, levelKey: string): number {
  return getSportLevel(sportKey, levelKey)?.suggestedHours ?? DEFAULT_SUGGESTED_HOURS;
}
