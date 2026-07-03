/* numu Console kit — fake data, per account. The rail switches between your own
   numu account and ORVCLE (a recording studio: tracks · sessions · artists ·
   releases). A chat-driven data workspace: nacl commands in a feed produce data
   blocks, and objects open in the Context panel viewers. */
window.CONSOLE_DATA = {
  me: { name: "Jean Mensah", initials: "JM", role: "builder · operator" },

  tenants: [
    { id: "platform", mark: "nu", name: "numu", sub: "platform", accent: "var(--accent)" },
    { id: "studio", mark: "OR", name: "orvcle-studio", sub: "studio", accent: "var(--chart-3)", active: true },
  ],

  composerChannels: [
    { id: "chat", icon: "chat-text", label: "Chat" },
    { id: "email", icon: "envelope", label: "Email" },
    { id: "sms", icon: "chat-dots", label: "SMS" },
    { id: "call", icon: "telephone", label: "Call" },
  ],

  connectors: [
    { group: "Google Workspace", items: [
      { id: "gmail", name: "Gmail", icon: "envelope-fill", color: "var(--chart-6)", kind: "Email", connected: true },
      { id: "gdrive", name: "Drive", icon: "folder-fill", color: "var(--chart-4)", kind: "Files", connected: true },
      { id: "gcal", name: "Calendar", icon: "calendar-event", color: "var(--chart-2)", kind: "Calendar", connected: true },
    ] },
    { group: "Music", items: [
      { id: "spotify", name: "Spotify for Artists", icon: "spotify", color: "var(--chart-4)", kind: "Streams", connected: true },
      { id: "apple", name: "Apple Music", icon: "music-note-beamed", color: "var(--chart-6)", kind: "Streams" },
      { id: "muso", name: "Muso.ai", icon: "person-vcard", color: "var(--chart-3)", kind: "Credits" },
      { id: "distrokid", name: "DistroKid", icon: "vinyl-fill", color: "var(--chart-1)", kind: "Distribution" },
    ] },
    { group: "Payments", items: [
      { id: "stripe", name: "Stripe", icon: "credit-card-2-front", color: "var(--chart-3)", kind: "Payments", connected: true },
      { id: "wero", name: "Wero", icon: "wallet2", color: "var(--chart-7)", kind: "Payments" },
    ] },
    { group: "Databases", items: [
      { id: "postgres", name: "PostgreSQL", icon: "database-fill", color: "var(--chart-8)", kind: "Database", host: "db.orvcle.io", port: "5432", database: "orvcle_prod", user: "numu_ro", ssl: "require" },
      { id: "gluesql", name: "GlueSQL", icon: "database-fill-lock", color: "var(--accent)", kind: "On-device", local: true, connected: true, store: "browser · IndexedDB", tables: "12" },
    ] },
  ],

  data: {
    /* ============ ORVCLE — recording & production studio ============ */
    studio: {
      overview: { id: "roster", icon: "soundwave", name: "Roster" },
      naclHint: "action:target.attribute=value · new · read · set · del",
      channels: [
        { id: "pinned", name: "Pinned", icon: "pin-angle-fill" },
        { id: "artists", name: "Artists", icon: "person-badge" },
        { id: "sessions", name: "Sessions", icon: "record-circle" },
        { id: "releases", name: "Releases", icon: "vinyl" },
      ],
      projects: [
        { id: "a1", name: "NOVA — debut EP", mark: "NV", color: "var(--chart-3)", channel: "artists", pinned: true, active: true },
        { id: "a2", name: "KESSY — single", mark: "KS", color: "var(--chart-5)", channel: "artists" },
        { id: "a3", name: "Studio A — 12 Jul", mark: "SA", color: "var(--chart-2)", channel: "sessions" },
        { id: "a4", name: "FW26 EP — master", mark: "FW", color: "var(--chart-4)", channel: "releases" },
      ],
      objects: [
        { id: "o1", type: "audio", name: "nova-midnight-run.wav", artist: "NOVA · rough mix", meta: "3:48", icon: "music-note-beamed", accent: "var(--chart-3)", duration: "3:48", pos: "1:12", posPct: 32 },
        { id: "oa1", type: "app", name: "redpash chat", meta: "qir · SQL · on device", icon: "terminal", accent: "var(--accent)", src: "../../uploads/dc.html" },
        { id: "od1", type: "dashboard", name: "Streams dashboard", meta: "2 charts", icon: "grid-1x2", accent: "var(--chart-3)", charts: [{ nacl: "monthly streams", type: "bar", cats: [{ label: "Jan", value: 12400 }, { label: "Feb", value: 18800 }, { label: "Mar", value: 22100 }, { label: "Apr", value: 26900 }, { label: "May", value: 31200 }, { label: "Jun", value: 38400 }] }, { nacl: "streams by platform", type: "donut", cats: [{ label: "Spotify", value: 62 }, { label: "Apple", value: 24 }, { label: "YouTube", value: 14 }] }] },
        { id: "o2", type: "audio", name: "kessy-lowlight.wav", artist: "KESSY · master v3", meta: "3:12", icon: "music-note-beamed", accent: "var(--chart-5)", duration: "3:12", pos: "0:44", posPct: 22 },
        { id: "o3", type: "video", name: "studio-A-live.mp4", meta: "8:20 · session", icon: "camera-video-fill", accent: "var(--chart-2)", duration: "8:20", pos: "2:10", posPct: 26 },
        { id: "o4", type: "image", name: "EP artwork · NOVA", meta: "6 shots", icon: "images", accent: "var(--chart-4)", gallery: 6 },
        { id: "o5", type: "case", name: "Recording — Studio A", code: "SES_118", status: "in_review", icon: "record-circle", accent: "var(--chart-2)",
          fields: [["artist", "NOVA"], ["service", "Recording"], ["engineer", "M. Okoro"], ["room", "Studio A"], ["date", "12 Jul · 14:00"], ["duration", "4h · auto"]] },
        { id: "o6", type: "record", name: "NOVA", code: "ART_09", status: "active", icon: "person-badge", accent: "var(--chart-3)",
          fields: [["genre", "Alt-R&B"], ["tracks", "5"], ["release", "debut EP · Q4"], ["sessions", "7"], ["credits", "Muso.ai"]] },
      ],
      suggestions: [{ text: "read:file.name=dossier" }, { text: "read:file.type=mp3" }, { text: "on:city=London set:country=England" }, { text: "read:id=345 set:region=\"Val de Marne\"" }, { text: "play:file.name=kessy-lowlight set:volume=10" }, { text: "set:theme.mode=dark" }],
      feed: [
        { type: "email", from: "A. Diallo · ACME Analytics", subject: "Export to clean — dossier.csv", time: "09:12",
          text: "Hi — here’s the raw export from last quarter. Can you clean it (dupes + full-null rows) and send back MRR by region?",
          attachment: { name: "dossier.csv", size: "48 KB", rows: "1,240" } },
      ],
    },

    /* ============ numu — platform ============ */
    platform: {
      overview: { id: "inbox", icon: "inbox", name: "Inbox" },
      naclHint: "case · type · grant · audit",
      channels: [
        { id: "pinned", name: "Pinned", icon: "pin-angle-fill" },
        { id: "build", name: "Build", icon: "hash" },
      ],
      projects: [
        { id: "b1", name: "Add Payout type", mark: "PT", color: "var(--chart-2)", channel: "build", pinned: true, active: true },
        { id: "b2", name: "RBAC reach audit", mark: "RB", color: "var(--chart-6)", channel: "build" },
      ],
      objects: [
        { id: "o4", type: "case", name: "Add Payout object type", code: "CAS_201", status: "in_review", icon: "clipboard-check", accent: "var(--chart-2)", fields: [["owner", "JM"], ["tag", "type"], ["checks", "2 / 3 passed"], ["missing", "review-approved"]] },
        { id: "o6", type: "record", name: "payout", code: "TYPE_11", status: "active", icon: "diagram-3", accent: "var(--accent)", fields: [["fields", "6"], ["verbs", "full set"], ["rbac", "two-plane"], ["audit", "on"]] },
      ],
      suggestions: [{ text: "case new" }, { text: "type payout" }, { text: "audit rbac" }],
      feed: [
        { type: "step", nacl: "type payout · 6 fields", kind: "type", impact: "type_definitions + type_fields written · registry hot-swapped" },
        { type: "object", objType: "case", title: "CAS_201 · Add Payout type", meta: "in_review · 2/3 checks", objIcon: "clipboard-check", accentColor: "var(--chart-2)", status: "in_review" },
      ],
    },
  },
};
