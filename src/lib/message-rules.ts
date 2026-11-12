/**
 * The message check (PRD decision #64): one shared list of sexual, abusive,
 * threatening and self-harm language, the same in every room.
 *
 * This file is the source of truth. `scripts/export-message-rules-vector.ts`
 * writes it, with test cases, to `docs/api/vectors/message-rules.json`; the
 * iOS and Android apps bundle that file and run the same engine, so the
 * device and the server always agree. The server is the only judge
 * (`src/lib/message-flags.server.ts`).
 *
 * Portability rules for every pattern, so JavaScript, ICU (Swift) and
 * java.util.regex (Kotlin) read it identically: lower-case letters, digits
 * and single spaces only; groups `(?:)`, `|`, `?`, `*`, `+`, `{m,n}`, character classes,
 * lookahead, and fixed-width lookbehind. No `\b`, `\w`, flags or
 * backreferences. `{NAME}` splices in an entry of `sets`.
 *
 * Text is normalized before matching (`normalizeVariants`): lower case, no
 * accents, no apostrophes ("you're" → "youre"), punctuation → spaces, and
 * the word "qzq" wherever a sentence breaks (after . ! ? ; : or a new line, or
 * at a dash or an emoji standing alone).
 */

export const MESSAGE_RULES_VERSION = "2026-11-10";

export const MESSAGE_CATEGORIES = ["sexual", "slur", "threat", "abuse", "self_harm"] as const;
export type MessageCategory = (typeof MESSAGE_CATEGORIES)[number];

/** Categories that warn the sender. `self_harm` never warns: it is flag-only. */
export const WARN_CATEGORIES: readonly MessageCategory[] = ["sexual", "slur", "threat", "abuse"];

export const MESSAGE_CATEGORY_INFO: Record<MessageCategory, { label: string; criteria: string }> = {
  sexual: {
    label: "Sexual",
    criteria:
      "Explicit sexual acts, sexualised comments about a person's body, requests for sexual contact or images.",
  },
  slur: {
    label: "Slurs",
    criteria: "Slurs about race, ethnicity, religion, sexuality, gender or disability.",
  },
  threat: {
    label: "Threats",
    criteria: "Stated intent to hurt someone, or telling someone to hurt themselves.",
  },
  abuse: {
    label: "Personal abuse",
    criteria: "Demeaning insults aimed at a person, not at a performance.",
  },
  self_harm: {
    label: "Self-harm said about oneself",
    criteria:
      "Flag only. The sender sees no warning and the message always sends; the sender is shown the 988 line.",
  },
};

export type MessageRule = {
  id: string;
  category: MessageCategory;
  /** Plain-language description for the admin Message rules page. */
  label: string;
  pattern: string;
};

export type MessageRuleSet = {
  version: string;
  /** Letter swaps undone inside a word: "@" → "a". */
  leet: Record<string, string>;
  /** Words a censored spelling ("f*ck") is read as. */
  censored: string[];
  sets: Record<string, string>;
  /** Phrases masked out before any rule runs. */
  never: { id: string; label: string; pattern: string }[];
  rules: MessageRule[];
  /** Deliberately not counted; shown on the admin page, not used by the engine. */
  notCounted: string[];
};

const GARMENTS = "clothes|shirt|top|pants|bra|underwear|dress|shorts|panties";
const INSULT_NOUNS =
  "asshole|dumbass|dipshit|shithead|dickhead|douche|douchebag|scumbag|idiot|jerk";

export const MESSAGE_RULE_SET: MessageRuleSet = {
  version: MESSAGE_RULES_VERSION,
  leet: {
    "@": "a",
    $: "s",
    "0": "o",
    "1": "i",
    "3": "e",
    "4": "a",
    "5": "s",
    "7": "t",
    "9": "g",
    "!": "i",
  },
  censored: [
    "fuck",
    "fucking",
    "fucked",
    "shit",
    "bitch",
    "cunt",
    "dick",
    "cock",
    "pussy",
    "slut",
    "whore",
    "asshole",
    "nigger",
    "nigga",
    "faggot",
    "retard",
    "fag",
    "dyke",
  ],
  sets: {
    /** "you are", "she's", "your daughter is" … */
    PBE: "(?:you are|youre|u r|u are|he is|hes|she is|shes|your (?:kid|daughter|son|child) is|that (?:kid|girl|boy) is)",
    /** The person on the receiving end. */
    OBJ: "(?:you|u|ya|him|her|them|your (?:whole |entire )?(?:kid|daughter|son|child|family|wife|husband)|that (?:kid|girl|boy))",
    /** First-person intent. */
    IWILL:
      "(?:ill|i will|im going to|i am going to|im gonna|i am gonna|imma|ima|im finna|im about to|i want to|i wanna|i should|someone should|somebody should)",
    /** Filler between "you are" and the insult. */
    FILL: "(?:(?:so|such|really|very|just|too|a|an|the|total|complete|little|fucking|freaking|nothing but|kind of|getting|being|always|still) ){0,3}",
    /** One more describing word joined on: "you're so lazy and worthless". */
    ALSO: "(?:(?!qzq )[a-z]+ (?:and|or|but) )?",
    /** The end of the sentence: the next thing is a sentence break ("qzq") or nothing. */
    END: "(?:(?= qzq)|(?! ))",
    /** Filler between "I'll" and the verb. */
    HARD: "(?:(?:fucking|literally|seriously|just|actually|absolutely|totally) ){0,2}",
  },
  never: [
    { id: "X1", label: "Latin honours", pattern: "(?:magna |summa )?cum laude" },
    {
      id: "X3",
      label: "Virgin in names and food",
      pattern:
        "virgin (?:islands?|mary|atlantic|america|mobile|galactic|olive)|extra virgin|virgin (?:mojitos?|margaritas?|daiquiris?|coladas?|pina coladas?|drinks?|cocktails?)|virgin (?:hotels?|run|voyage|flight)",
    },
    {
      id: "X4",
      label: "Place names, history and idioms that contain a listed word",
      pattern:
        "negro leagues?|coon rapids|maine coons?|squaw (?:valley|creek|peak)|homo sapiens?|chinks? in|spic and span|homo milk",
    },
    {
      id: "X5",
      label: "Suicide drills and the suicide squeeze",
      pattern:
        "suicides? (?:prevention|awareness|hotline|squad|drills?|sprints?|runs?|squeeze|pass|passes|play|hill)|(?:a|another|one more|each|every|per) suicide(?! note| attempt)|(?:run|running|ran|do|doing|did) (?:[a-z0-9]+ ){0,2}suicides?",
    },
    {
      id: "X7",
      label: "A title and a surname that is also a listed word (Coach Dyke, Mrs. Coon)",
      pattern:
        "(?:coach|mr|mrs|ms|miss|dr|mister|van|von|de)(?: qzq)? (?:dyke|dykes|coon|coons|hoe|cox|virgin)|(?:dyke|dykes|coon|coons) family|kike hernandez",
    },
    {
      id: "X8",
      label: "Sex ed, same-sex, opposite sex",
      pattern: "sex ed|sex education|same sex|opposite sex",
    },
    {
      id: "X6",
      label: "An insult the sender aims at themselves",
      pattern: `(?:i felt like|i feel like|i was|im|i am|i was being|i sounded like|i acted like) (?:a |an |such a |such an |being a |being an )?(?:total |complete |real |fucking |stupid )?(?:${INSULT_NOUNS})`,
    },
  ],
  rules: [
    /* ---------------- Sexual ---------------- */
    {
      id: "S1",
      category: "sexual",
      label: "Named sex acts (blowjob, handjob …)",
      pattern: "blow ?jobs?|hand ?jobs?|rim ?jobs?|foot ?jobs?",
    },
    {
      id: "S2",
      category: "sexual",
      label: "Masturbation",
      pattern:
        "jerk(?:ing|ed)? (?:me |you |him )?off(?! the| of| his| her)|jack(?:ing|ed)? (?:me |you |him |it )?off|masturbat[a-z]*|wank[a-z]*",
    },
    {
      id: "S3",
      category: "sexual",
      label: "Cum, jizz",
      pattern:
        "cum|cumshots?|jizz[a-z]*|(?:im|i am|youre|hes|shes|keep|kept|was|were|not|stop) cumming",
    },
    {
      id: "S4",
      category: "sexual",
      label: "Arousal (horny, boner, erection)",
      pattern: "orgasm[a-z]*|horny|horney|boners?|erections?|(?:a|my|his|your) hard on{END}",
    },
    {
      id: "S5",
      category: "sexual",
      label: "Porn, nudes, sexting",
      pattern:
        "porn[a-z]*|onlyfans|(?:send|sent|any|your|my|her|his|trade|share|leaked?|some) nudes|nudes{END}|send (?:me )?(?:a )?nude|nude (?:pics?|photos?|pictures?|selfies?|videos?)|(?:pose|posing|get|youre|you are) nude{END}|in the nude|naked (?:pics?|photos?|pictures?|selfies?|videos?)|dick pics?|sext(?:s|ing|ed)?|get naked|got naked|naked for me|see (?:you|u) naked",
    },
    {
      id: "S6",
      category: "sexual",
      label: "Explicit acts",
      pattern:
        "deep ?throat[a-z]*|gang ?bang[a-z]*|threesomes?|creampie[a-z]*|anal sex|oral sex|(?:like|into|try) anal|cock ?suckers?|69ing",
    },
    {
      id: "S7",
      category: "sexual",
      label: "Crude words for body parts",
      pattern: "tits|titties|titty|boobies|clit|pussy|pussies|cunts?",
    },
    { id: "S8", category: "sexual", label: "Sexy", pattern: "sexy|sexier|sexiest" },
    {
      id: "S9",
      category: "sexual",
      label: "Having sex",
      pattern: "have sex|having sex|had sex|sex with|wants? sex|for sex{END}|sex tapes?|sex toys?",
    },
    {
      id: "S10",
      category: "sexual",
      label: "Making out, hooking up, sleeping with",
      pattern:
        "mak(?:e|ing) out with (?:him|her|you|me)|made out with (?:him|her|you|me)|hook(?:ed|ing) up with (?:him|her|you|me){END}|(?:want to|wanna|lets|we should|we could) hook up{END}|slept with (?:you|him|her){END}",
    },
    {
      id: "S11",
      category: "sexual",
      label: "Turned on",
      pattern:
        "turn(?:s|ed|ing)? (?:me|you|him|her) on{END}|turn(?:s|ed|ing)? (?:me|you|him|her) on so|(?:im|i am|i get|getting|so|really) turned on{END}|turned on (?:by you|right now|when you)",
    },
    {
      id: "S12",
      category: "sexual",
      label: "Fuck, used sexually",
      pattern:
        "fuck (?:me|her|him)(?! up| over)|fucked (?:me|her|him|you)(?! up| over)|fuckable|(?:want to|wanna|gonna|going to|like to|lets|we should) fuck(?! up| with| around| it| this| that| my)|fucking (?:you|u){END}|about fucking (?:you|u)",
    },
    {
      id: "S13",
      category: "sexual",
      label: "Suck my, lick your, ride me",
      pattern:
        "suck my|suck(?:ing)? (?:me|him) off|lick (?:my|your|her)(?! (?:wounds|lips|fingers|plate))|ride me|ride my (?:dick|cock)|(?:love|want|need) (?:your |my |some )?(?:cock|dick|pussy)|sit on my (?:face|lap)",
    },
    {
      id: "S14",
      category: "sexual",
      label: "Undressing",
      pattern:
        "topless|strip for|undress for me|get undressed for me|take (?:it|them) (?:all )?off for|take off your (?:clothes|shirt|top|pants|bra|underwear|dress|shorts|panties)(?:{END}| for me| now| slowly)|take your (?:clothes|shirt|top|pants|bra|underwear|dress|shorts|panties) off(?:{END}| for me| now| slowly)",
    },
    { id: "S15", category: "sexual", label: "Virgin, virginity", pattern: "virgins?|virginity" },
    {
      id: "S16",
      category: "sexual",
      label: "Touching yourself, fingering",
      pattern:
        "touch(?:ing)? (?:yourself|myself)(?! on| at| where| here)|finger(?:ed|ing)? (?:you|her|me)",
    },
    {
      id: "S17",
      category: "sexual",
      label: "Slut, whore, skank, hoe",
      pattern:
        "sluts?|thots?|slutty|whores?|skanks?|skanky|hoes|(?:a|you|that|little|stupid|fucking) hoe",
    },
    {
      id: "S20",
      category: "sexual",
      label: "Calling a person hot",
      pattern:
        "(?:youre|you are|you look|u look|u r|ur|you looked) (?:(?:so|really|very|fucking|smoking|super|damn) )+hot(?: right now| rn| tonight| today| af| as hell| as fuck| baby| babe| girl| in (?:that|those|this|your) [a-z]+)?{END}|(?:youre|you are|you look|u look|you looked) hot (?:af|in (?:that|those|this|your) [a-z]+)",
    },
    {
      id: "S21",
      category: "sexual",
      label: "Comments on a person's body",
      pattern:
        "(?:nice|great|love your|love that|look at that|look at your|sexy) (?:ass(?! goal| day| shot| move| game| save| play| time)|butt{END}|boobs|tits|thighs|lips)|(?:nice|hot|sexy|love your|i love your|look at that) body{END}|your (?:boobs|tits|ass|butt|rack|breasts) (?:look|looks) (?:so |really )?(?:great|good|amazing|hot|nice|sexy)",
    },
    {
      id: "S22",
      category: "sexual",
      label: "Asking for a picture of the person",
      pattern:
        "(?:send|show|text|snap) (?:me |us )?(?:a |some |another )?(?:pic|pics|photo|photos|picture|pictures|selfie|selfies|video|videos) of (?:(?:you|u|yourself){END}|(?:you|u) in (?:your|a|that|the) (?:bikini|underwear|bra|swimsuit|bathing suit|shower|bed|towel|lingerie|panties)|your (?:body|legs|butt|ass|chest|boobs|tits|abs|bikini|underwear|bra|dick|cock|penis|pussy))",
    },
    {
      id: "S23",
      category: "sexual",
      label: "What are you wearing",
      pattern:
        "what are (?:you|u) wearing(?: right now| rn| tonight| to bed| baby| babe| under[a-z]*)?{END}",
    },
    {
      id: "S24",
      category: "sexual",
      label: "In your underwear",
      pattern:
        "(?:you|u|yourself|pics?|photos?|pictures?|selfies?) (?:in|without) (?:your|just your|only your|a) (?:underwear|bra|panties|bikini|thong|undies|lingerie|boxers)",
    },
    {
      id: "S25",
      category: "sexual",
      label: "Wanting to kiss or touch the person",
      pattern:
        "(?:want to|wanna|going to|gonna|let me|can i|could i|wish i could|like to) (?:kiss|touch|taste|cuddle|lick|spank) (?:you|u)(?! (?:up|out|on that|back|base))|(?:kiss|lick|grope|fondle|caress) your (?:body|neck|legs?|thighs?|chest|butt|ass|breasts|boobs|stomach)",
    },
    {
      id: "S26",
      category: "sexual",
      label: "Kiss me, in bed with",
      pattern:
        "kiss me(?! by| goodbye| goodnight| good night| bye)|cuddle with me|come to bed with",
    },
    {
      id: "S27",
      category: "sexual",
      label: "Anatomical words next to a sexual verb",
      pattern:
        "(?:see|show|touch|feel|suck|lick|grab|rub|send|stroke|squeeze)(?: [a-z]+){0,3} (?:my|your|his|her) (?:dick|cock|penis|vagina|breasts|nipples|boobs|tits|crotch|privates|private parts|pussy)|(?:show|send)(?: me)? (?:your|ur) (?:ass|butt|boobs|tits)|see your ass{END}",
    },
    {
      id: "S28",
      category: "sexual",
      label: "Explicit demands",
      pattern:
        "suck (?:a|my|his) (?:dick|cock)|eat (?:me|you|her) out|blow me(?! away| off| out| over)|bend over for me|bend (?:you|her) over|you make me (?:so )?(?:hard|wet|horny)|(?:im|i am) (?:so |really )?horny|(?:im|i am) (?:so |really )?(?:hard|wet) for (?:you|u){END}",
    },
    {
      id: "S29",
      category: "sexual",
      label: "Sexualised names for a person",
      pattern:
        "(?:youre|you are|shes|she is|hes|he is) (?:such a |a |so |a total |a little )?(?:snack|hottie|babe){END}|jailbait|call me daddy",
    },

    {
      id: "S30",
      category: "sexual",
      label: "Rape and molestation",
      pattern: "rape[sd]?|raping|rapists?|molest[a-z]*",
    },

    /* ---------------- Slurs ---------------- */
    {
      id: "L1",
      category: "slur",
      label: "Anti-Black slurs",
      pattern: "nigg(?:er|a|ah|uh)[a-z]*|jigaboos?|porch monkeys?|coons?|darkies?|darky|niqqas?",
    },
    {
      id: "L2",
      category: "slur",
      label: "Anti-Asian slurs",
      pattern: "chinks?|chinky|gooks?|japs?|zipperheads?|ching chong|slant ?eyes?|slant ?eyed",
    },
    {
      id: "L3",
      category: "slur",
      label: "Anti-Latino slurs",
      pattern: "spics?|wetbacks?|beaners?",
    },
    {
      id: "L4",
      category: "slur",
      label: "Antisemitic slurs",
      pattern: "kikes?|heebs?|dirty jews?",
    },
    {
      id: "L5",
      category: "slur",
      label: "Anti-Arab, anti-Muslim and anti-South-Asian slurs",
      pattern: "rag ?heads?|towel ?heads?|sand nigg[a-z]*|camel jockeys?|pakis?",
    },
    {
      id: "L6",
      category: "slur",
      label: "Anti-Native slurs",
      pattern: "squaws?|injuns?",
    },
    {
      id: "L7",
      category: "slur",
      label: "Anti-gay slurs",
      pattern: "faggots?|faggits?|faggy|fags?|homos?|dykes?|lesbos?",
    },
    { id: "L8", category: "slur", label: "Anti-trans slurs", pattern: "tranny|trannies|shemales?" },
    {
      id: "L9",
      category: "slur",
      label: "Retard and its compounds",
      pattern: "retards?|retarded|retarted|tards?|libtards?|fucktards?",
    },
    {
      id: "L10",
      category: "slur",
      label: "Other disability slurs",
      pattern: "mongoloids?|(?:you|that|fucking|little|stupid) cripple",
    },
    {
      id: "L11",
      category: "slur",
      label: "Go back to your country",
      pattern: "go back to your (?:own )?country|you people are all (?:the same|alike)",
    },
    {
      id: "L12",
      category: "slur",
      label: "Gay, queer or trans used as an insult",
      pattern:
        "(?:thats|that is|this is|its|it is|youre|you are|hes|shes) so gay|fucking (?:queers?|gays?|lesbians?|trans)",
    },

    /* ---------------- Threats ---------------- */
    {
      id: "T1",
      category: "threat",
      label: "I'll kill, hurt, slap, punch … you",
      pattern:
        "{IWILL} {HARD}(?:kill|murder|slap|smack|punch|choke|strangle|stab) (?:you|u|ya|all of you|him|them|your (?:whole |entire )?(?:kid|daughter|son|child|family|wife|husband|mom|dad|mother|father|brother|sister)|that (?:kid|girl|boy)|her(?:{END}| (?:if|when|and|so|too|for|myself|with|until|unless|again|now|tonight|tomorrow|i swear|i mean it|i promise)))|{IWILL} {HARD}hurt (?:you|u|your (?:whole |entire )?(?:kid|daughter|son|child|family|wife|husband|mom|dad|mother|father|brother|sister))|{IWILL} {HARD}end (?:you|u){END}|{IWILL} {HARD}(?:hit|shoot) (?:you|u|him|her|them)(?:{END}| in the| so hard| i swear| i mean it)|{IWILL} {HARD}beat (?:you|u|him|her|them) up|{IWILL} {HARD}(?:beat|kick) your ass(?! in| at| on)|{IWILL} {HARD}break (?:your|his|her) (?:legs?|neck|arms?|face|nose|jaw|kneecaps?|fingers?)|{IWILL} {HARD}(?:slit your throat|snap your neck|knock your teeth out|beat (?:you|him|her) to a pulp|put (?:you|him|her) in (?:the|a) hospital|burn your house down|cut you{END})",
    },
    {
      id: "T2",
      category: "threat",
      label: "Telling someone to kill themselves",
      pattern:
        "(?<!dont )(?<!need to )(?<!have to )kill (?:yourself|urself|your self)(?! trying| over| to get| rushing| getting| for| in | on )|kys|go die|drop dead(?! gorgeous| date)|hang yourself|end yourself|end your life|slit your wrists?|unalive yourself|(?:go|just|should) off yourself",
    },
    {
      id: "T3",
      category: "threat",
      label: "Hoping someone dies or is hurt",
      pattern:
        "(?:you should|u should|i hope you|i hope u|hope you|hope she|hope he|hope they|i hope she|i hope he|i hope they) (?:all )?(?:die|dies|get hurt{END}|gets hurt{END}|get cancer|gets cancer|get hit by|gets hit by|break your (?:leg|legs|neck|arm|ankle|back|face|nose)|breaks (?:her|his) (?:leg|neck|arm|ankle|back)|rot|rots)|hope your (?:kid|daughter|son|child) (?:dies|gets hurt|breaks (?:her|his) (?:leg|neck|arm|back))|(?:you|u|she|he|they) deserves? to (?:die|be shot|get hurt)|(?:you|u|she|he|they) should be shot",
    },
    {
      id: "T4",
      category: "threat",
      label: "You're dead",
      pattern:
        "(?:youre|you are|ur) (?:so |fucking )?dead{END}|(?:youre|you are) dead meat|(?:youre|you are) a dead (?:man|woman|girl|boy)",
    },
    {
      id: "T5",
      category: "threat",
      label: "I know where you live, watch your back",
      pattern:
        "i know where you live|(?:ill|i will) find you wherever|(?:ill|i will) find you and (?:kill|hurt|end|make)|(?:you )?better watch your back{END}|watch your back(?: qzq)? i mean it|you better watch yourself",
    },
    {
      id: "T6",
      category: "threat",
      label: "Beat the crap out of",
      pattern:
        "(?:beat|knock|slap|kick|smack) the (?:shit|crap|hell|snot|piss|fuck) out of (?:you|u|him|her|your)",
    },
    {
      id: "T7",
      category: "threat",
      label: "You'll regret this",
      pattern:
        "(?:ill make you|im going to make you|you will|youll|youre going to|youre gonna) (?:regret this|pay for (?:this|what you (?:did|said)))(?: tomorrow| someday| soon| one day)?{END}",
    },
    {
      id: "T8",
      category: "threat",
      label: "Threats to a career",
      pattern:
        "(?:ill|i will) ruin (?:you|her|him){END}|(?:ill|i will) ruin your (?:life|career|reputation)|ill end your career|(?:youll|you will) never (?:coach|skate|play|compete|work) again{END}",
    },
    {
      id: "T9",
      category: "threat",
      label: "Weapons",
      pattern:
        "bring(?:ing)? a gun|i have a gun|i got a gun|shoot up (?:the|this|that|your) (?:rink|school|gym|arena|pool|building|locker room)|bring my (?:gun|knife)",
    },

    /* ---------------- Personal abuse ---------------- */
    {
      id: "A1",
      category: "abuse",
      label: "You're worthless, useless, pathetic …",
      pattern:
        "{PBE} {FILL}(?:worthless|pathetic|disgrace|embarrassment|waste of (?:space|time|air|oxygen|talent)|failure|loser|disappointment|piece of (?:garbage|trash|crap))|{PBE} {FILL}(?:useless|hopeless|disgusting|waste|trash|garbage|joke|nothing)(?: honestly| lol| lmao)?{END}|{PBE} {FILL}{ALSO}{FILL}(?:worthless|pathetic|disgrace|embarrassment|waste of (?:space|time|air|oxygen|talent)|failure|loser|disappointment|piece of (?:garbage|trash|crap)|useless|hopeless|disgusting|waste|trash|garbage|joke|nothing){END}",
    },
    {
      id: "A2",
      category: "abuse",
      label: "You're stupid, an idiot, a moron",
      pattern:
        "{PBE} {FILL}(?:stupid(?! fast| strong| good| quick| easy)|dumb(?! luck)|idiot|idiotic|moron|imbecile|brainless|brain ?dead)|{PBE} {FILL}{ALSO}{FILL}(?:stupid|dumb|idiot|idiotic|moron|imbecile|brainless|brain ?dead){END}",
    },
    {
      id: "A3",
      category: "abuse",
      label: "You're fat, ugly, gross",
      pattern:
        "{PBE} {FILL}(?:fat|chubby|obese|whale|cow|ugly|hideous)|{PBE} {FILL}{ALSO}{FILL}(?:fat|chubby|obese|ugly|gross|hideous){END}|(?:you|she|he|your (?:kid|daughter|son|child)) (?:look|looks|got|is getting|are getting|have gotten|has gotten) (?:so |really |very |too )?(?:fat|chubby|ugly|gross)(?:{END}| in (?:that|those|your))|(?:youve|you have|shes|hes) gotten (?:so |really |too )?fat",
    },
    {
      id: "A4",
      category: "abuse",
      label: "Telling a person to lose weight or eat less",
      pattern:
        "(?<!think )(?<!thinks )(?<!said )(?<!say )(?:you|u|she|he|your (?:kid|daughter|son|child)) (?:need|needs|should|better|have|has|gotta|got) (?:to )?(?:lose (?:some |a little |more )?weight|go on a diet|stop eating so much|eat less|stop eating|skip (?:a )?meals?){END}|(?:you|u|she|he) needs? to lose [0-9]+ (?:pounds|lbs)",
    },
    {
      id: "A5",
      category: "abuse",
      label: "Names for a fat person",
      pattern: "fat ?ass|fatso|lard ?ass|tub of lard|porker|(?:you|hey|little|such a|a) fatty{END}",
    },
    {
      id: "A6",
      category: "abuse",
      label: "Nobody likes you, I hate you",
      pattern:
        "(?:nobody|no one) (?:likes|wants|cares about|loves) (?:you|u)(?:{END}| here| just| anyway)|(?:everyone|everybody|the whole team) hates (?:you|u)|i hate (?:you|u)|we all hate (?:you|u)|i hate your guts",
    },
    {
      id: "A7",
      category: "abuse",
      label: "You'll never be good enough",
      pattern: "(?:youll|you will|ull) never (?:be good enough|be anything|be any good|amount to)",
    },
    {
      id: "A8",
      category: "abuse",
      label: "You make me sick, you disgust me",
      pattern:
        "you make me sick|you disgust me|im ashamed of you|i am ashamed of you|youre dead to me|you are dead to me|wish you were never born",
    },
    {
      id: "A9",
      category: "abuse",
      label: "Crybaby, wuss, sissy",
      pattern:
        "cry ?baby|stop crying you (?:little |big )?(?:baby|brat|wimp)|you little baby|such a little baby|(?:stop|quit) (?:being|acting like) a (?:little )?baby|wuss|(?:you|a|such a|little|dont be a) sissy(?! squats?)|(?:you|a|such a|little) pansy|dont be (?:a|such a) (?:pussy|baby|girl|wimp)|man up you",
    },
    {
      id: "A10",
      category: "abuse",
      label: "You + insult (you little brat, stupid bitch)",
      pattern:
        "(?:you|you little|you stupid|you fat|you lazy|you ugly|you dumb|you fucking|u) (?:bitch|shit|brat|bastard|prick|twat|asshole|piece of shit|piece of crap|idiot|moron|loser|slut|whore|cunt|fucker|fuck)|(?:little|stupid|fat|lazy|ugly|dumb|fucking|crazy|shut up|what a|that) (?:bitch|bastard|prick|twat|asshole|moron|slut|whore|cunt)|(?:you|you fat|you stupid|you lazy|you ugly|fat|stupid) (?:cow|pig)",
    },
    {
      id: "A11",
      category: "abuse",
      label: "Insult nouns (asshole, dumbass, scumbag …)",
      pattern:
        "piece of shit|assholes?|dumbass(?:es)?|dipshits?|shitheads?|dickheads?|douche(?:bag|bags|s)?|scumbags?|mother ?fuckers?",
    },
    {
      id: "A12",
      category: "abuse",
      label: "Fuck you, fuck off, stfu",
      pattern:
        "(?:fuck|fuk|fck|fuc|fuq|phuck|fvck) (?:you|u|off|yall|your mom|them all)|fuckyou|fu ck you|go fuck (?:yourself|urself)|screw you(?! guys| over| up)|shut the fuck up|stfu",
    },
    {
      id: "A13",
      category: "abuse",
      label: "You're a bitch, a psycho, a head case",
      pattern:
        "{PBE} {FILL}(?:bitch|bastard|prick|dick|cunt|psycho|nut ?job|head ?case|brat|spoiled brat)|{PBE} {FILL}{ALSO}{FILL}(?:bitch|bastard|prick|dick|cunt|psycho|nut ?job|head ?case|brat|spoiled brat){END}",
    },
    {
      id: "A14",
      category: "abuse",
      label: "The worst coach, a terrible mother",
      pattern:
        "{PBE} the worst (?:coach|parent|mother|father|mom|dad|person)|worst coach (?:ever|in the world)|(?<!think )(?<!thinks )(?<!say )(?<!said ){PBE} {FILL}(?:terrible|horrible|awful|bad|unfit|shitty|lousy) (?:mother|father|mom|dad|parent|coach|person)|{PBE} unfit to be a (?:parent|mother|father|mom|dad|coach)",
    },

    {
      id: "A15",
      category: "abuse",
      label: '"Your worthless" (you\'re, misspelled)',
      pattern:
        "(?:your|ur) (?:so |such a |such an |a |an )?(?:worthless|useless|pathetic|disgusting){END}|(?:your|ur) so (?:stupid|dumb|ugly|fat|lazy){END}",
    },

    /* ---------------- Self-harm said about oneself (flag only) ---------------- */
    {
      id: "H1",
      category: "self_harm",
      label: "Killing myself, suicide",
      pattern:
        "kill(?:ing)? myself(?! trying| to get| over| with| in practice| at practice| on )|(?<![0-9] )(?<!few )(?<!many )(?<!more )(?<!several )kms|end(?:ing)? my life|end(?:ing)? it all|tak(?:e|ing) my own life|suicide|suicidal|unalive myself",
    },
    {
      id: "H2",
      category: "self_harm",
      label: "I want to die, to disappear",
      pattern:
        "(?:i want to|i wanna|i wish i could|i just want to|i just wanna) (?:just )?(?:die|disappear|not exist|not be here|not wake up){END}|i want to end it{END}|i think about dying",
    },
    {
      id: "H3",
      category: "self_harm",
      label: "Better off without me, no reason to live",
      pattern:
        "i wish i (?:was|were) dead|i wish i was never born|i wish id never been born|i wish i wasnt alive|better off dead|better off without me|better off if i was gone|no reason to live|no point in living|nothing to live for|dont (?:want to|wanna) live{END}|dont (?:want to|wanna) live anymore|dont (?:want to|wanna) be alive|dont (?:want to|wanna) be here anymore{END}|i cant go on (?:anymore|living)",
    },
    {
      id: "H4",
      category: "self_harm",
      label: "Hurting, cutting or starving myself",
      pattern:
        "(?<!dont )(?<!didnt )(?<!do not )(?:want to|wanna|thinking about|thought about) (?:hurt|hurting|harm|harming) myself|(?:want to|wanna|going to|gonna|thinking about|thought about|started) (?:cut|cutting) myself(?! off| some| a | on| with)|been cutting myself(?! off| some| a | on| with)|been cutting{END}|been cutting again|self ?harm[a-z]*|starv(?:e|ing) myself(?! of)|mak(?:e|ing) myself throw up|i (?:cut|burned|burnt) myself on purpose|i cut myself (?:last night|again)(?! on| with)|i overdosed|took a bunch of pills",
    },
    {
      id: "H5",
      category: "self_harm",
      label: "I hate myself, nobody would miss me",
      pattern:
        "i hate myself{END}|(?:im|i am) worthless{END}|(?:im|i am) a burden{END}|(?:nobody|no one) would miss me{END}|(?:nobody|no one) would care if i",
    },
  ],
  notCounted: [
    "Ordinary swearing with no person as its target (hell, damn, shit, fuck, bitch).",
    '"Shut up" and "shut your mouth".',
    '"You\'re lazy" on its own.',
    "All emoji.",
    "Anatomical words (penis, vagina, breasts) with no sexual verb, so an injury or a plainly worded disclosure passes.",
    '"Sexual", "SafeSport" and other safeguarding words (sexual misconduct, sexual abuse, sex ed, same-sex).',
    "Words people use to describe themselves: gay, lesbian, queer, trans, bisexual, Black, Jewish, Muslim, disabled, autistic.",
    "Skating terms: spread eagle, death spiral, death drop, camel, layback, catch-foot, Biellmann.",
    "Praise and cues: kill it, killed it, crushed it, attack the jump, break a leg.",
    "Sport terms: kill (volleyball), sack, hooker (rugby), tight end, clean and jerk, snatch, hip thrust, strip the ball, penetration, shaft, butt end, breaststroke.",
    "Youth hockey level names: Mite, Squirt, Peewee, Bantam, Midget.",
    "Body cues and injuries: groin, glutes, butt, hips, chest, thigh, hamstring.",
    "Capital letters and repeated exclamation marks.",
    "Languages other than English.",
  ],
};

export type MessageMatch = {
  category: MessageCategory;
  ruleId: string;
  /** The normalized words that matched. */
  matched: string;
};

/* ---------------- normalization ---------------- */

const MASK = " xnx ";
const SENTENCE_BREAK = "qzq";

function readCensored(token: string, set: MessageRuleSet): string {
  if (token.length > 12 || !/^[a-z]+[*_][a-z*_]*$/.test(token)) return token;
  const shape = new RegExp(`^${token.replace(/[*_]/g, "[a-z]")}$`);
  // "c***" could be more than one listed word: only an unambiguous spelling is read.
  const words = set.censored.filter((word) => shape.test(word));
  return words.length === 1 ? words[0] : token;
}

function undoLeet(token: string, set: MessageRuleSet): string {
  if (!/[a-z]/.test(token)) return token;
  let out = token.replace(/[@$]/g, (ch) => set.leet[ch] ?? ch);
  out = out.replace(/(?<=[a-z])[0134579!]+(?=[a-z])/g, (run) =>
    [...run].map((ch) => set.leet[ch] ?? ch).join(""),
  );
  return out;
}

/**
 * The forms of a message the rules are run against: the plain one, with
 * stretched letters squeezed ("sexxxy"), and with spelled-out letters joined
 * ("f u c k").
 */
export function normalizeVariants(text: string, set: MessageRuleSet = MESSAGE_RULE_SET): string[] {
  const lowered = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’ʼ`']/g, "");
  const base = lowered
    // Zero-width characters and the soft hyphen can't be used to split a word.
    .replace(/[\u200b-\u200d\u2060\u00ad]/g, "")
    // A new line ends a sentence.
    .replace(/[\r\n]+/g, " . ")
    .split(/\s+/)
    .map((token) => {
      const tail = /[.,!?;:)"\]]+$/.exec(token)?.[0] ?? "";
      const word = undoLeet(readCensored(token.replace(/^[("[]+|[.,!?;:)"\]]+$/g, ""), set), set);
      // A sentence break becomes the word "qzq", so no rule runs across it and
      // {END} can ask for the end of a sentence.
      // So does a token with no letters or digits at all (a dash, an emoji).
      if (token !== "" && !/[a-z0-9]/.test(token)) return SENTENCE_BREAK;
      // "k.y.s." is a spelled-out word, not three sentences.
      if (/^(?:[a-z]\.)+[a-z]?$/.test(token)) return word;
      return /[.!?;:]/.test(tail) ? `${word} ${SENTENCE_BREAK}` : word;
    })
    .join(" ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const squeezed = [
    base,
    base.replace(/([a-z])\1{2,}/g, "$1"),
    base.replace(/([a-z])\1{2,}/g, "$1$1"),
  ];
  const joined = squeezed.map((v) =>
    v.replace(/(?<![a-z0-9])(?:[a-z] ){2,}[a-z](?![a-z0-9])/g, (run) => run.replace(/ /g, "")),
  );
  return [...new Set([...squeezed, ...joined])];
}

/* ---------------- engine ---------------- */

type Compiled = {
  never: RegExp[];
  rules: { rule: MessageRule; re: RegExp }[];
};

const compiledCache = new WeakMap<MessageRuleSet, Compiled>();

function expand(pattern: string, sets: Record<string, string>): string {
  return pattern.replace(/\{([A-Z]+)\}/g, (_, name: string) => {
    const value = sets[name];
    if (value === undefined) throw new Error(`message-rules: unknown set {${name}}`);
    return expand(value, sets);
  });
}

function wholeWords(pattern: string, sets: Record<string, string>, flags = ""): RegExp {
  return new RegExp(`(?<![a-z0-9])(?:${expand(pattern, sets)})(?![a-z0-9])`, flags);
}

function compile(set: MessageRuleSet): Compiled {
  const hit = compiledCache.get(set);
  if (hit) return hit;
  const compiled: Compiled = {
    never: set.never.map((n) => wholeWords(n.pattern, set.sets, "g")),
    rules: set.rules.map((rule) => ({ rule, re: wholeWords(rule.pattern, set.sets) })),
  };
  compiledCache.set(set, compiled);
  return compiled;
}

/** Every rule a message trips, at most one per category, in list order. */
export function matchMessage(text: string, set: MessageRuleSet = MESSAGE_RULE_SET): MessageMatch[] {
  const { never, rules } = compile(set);
  const found = new Map<MessageCategory, MessageMatch>();
  for (const variant of normalizeVariants(text, set)) {
    let masked = variant;
    for (const re of never) masked = masked.replace(re, MASK);
    for (const { rule, re } of rules) {
      if (found.has(rule.category)) continue;
      const m = re.exec(masked);
      if (m) found.set(rule.category, { category: rule.category, ruleId: rule.id, matched: m[0] });
    }
  }
  return MESSAGE_CATEGORIES.flatMap((c) => found.get(c) ?? []);
}

/**
 * The one result the product acts on: a warn-category match if there is one
 * (sexual, slur, threat, abuse, in that order), otherwise a self-harm match,
 * otherwise null.
 */
export function checkMessage(
  text: string,
  set: MessageRuleSet = MESSAGE_RULE_SET,
): MessageMatch | null {
  const matches = matchMessage(text, set);
  return (
    matches.find((m) => WARN_CATEGORIES.includes(m.category)) ??
    matches.find((m) => m.category === "self_harm") ??
    null
  );
}
