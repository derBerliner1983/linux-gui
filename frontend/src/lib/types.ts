// Typen der Oberfläche – reduziert auf Dashboard und Terminal.
// Weitere Bereiche kommen später zurück; dann wachsen die Typen hier mit.

export interface User {
  id: number;
  username: string;
  /** Frei wählbarer Anzeigename; leer → Anmeldename. */
  displayName?: string;
  role: 'admin' | 'viewer';
  totpEnabled?: boolean;
}

/** Anmeldefähiges Linux-Konto des Servers (für das Terminal). */
export interface LinuxUser { name: string; uid: number; shell: string; home: string }

export type TerminalMode = 'root' | 'user' | 'login' | 'service';

export interface TerminalInfo {
  available: boolean;
  resize: boolean;
  runningAsRoot: boolean;
  /** Konto, unter dem der Core-Hub-Dienst selbst läuft. */
  serviceUser: string;
  users: LinuxUser[];
  modes: Record<TerminalMode, { available: boolean; reason: string | null }>;
  defaultMode: TerminalMode;
}

export interface SystemStats {
  cpu: { usage: number; cores: number; brand: string; speed: number; perCore: number[] };
  memory: {
    total: number; used: number; free: number; available: number; percent: number;
    breakdown: { system: number; docker: number; vm: number; free: number };
  };
  disk: { fs: string; type: string; size: number; used: number; available: number; percent: number; mount: string }[];
  network: { iface: string; rx_bytes: number; tx_bytes: number; rx_sec: number; tx_sec: number; operstate: string }[];
  os: { hostname: string; platform: string; distro: string; release: string; kernel: string; arch: string; uptime: number };
  gpu?: GpuStat[];
}

export interface GpuStat {
  name: string;
  vendor: 'nvidia' | 'amd' | 'unknown';
  utilizationPct: number | null;
  vramTotalMb: number | null;
  vramUsedMb: number | null;
  unified: boolean;
}

export interface VersionInfo {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  behind?: number;
  method?: string;
  releaseUrl: string | null;
  repo: string;
  checkedAt: string;
  error?: string;
  /** Branch, dem die Update-Quelle folgt. */
  branch?: string;
  /** Aktuell ausgecheckter Commit (SHA) des Quell-Verzeichnisses. */
  ref?: string;
}

export interface OptimizeSuggestion {
  id: string;
  severity: 'info' | 'warn';
  title: string;
  detail: string;
  actionType?: 'process' | 'container' | 'link';
  actionTarget?: string;
  actionLabel?: string;
}

export interface MemoryModule { size: string; type: string; speed: string; locator: string }

export interface MemorySplit {
  installedBytes: number;
  kernelTotalBytes: number;
  kernelAvailableBytes: number;
  reservedBytes: number;
  modules: MemoryModule[];
  installedSource: 'dmidecode' | 'unbekannt';
}

export interface GpuMemory {
  card: string;
  name: string;
  driver: string;
  vramTotalBytes: number;
  vramUsedBytes: number;
  visibleVramBytes: number;
  gttTotalBytes: number;
  gttUsedBytes: number;
  unified: boolean;
}

export interface FirmwareInfo {
  biosVendor: string; biosVersion: string; biosDate: string;
  boardVendor: string; boardName: string; productName: string;
  available: boolean;
}

export interface KernelMemParam { key: string; value: string; note: string }

export interface KernelInfo { version: string; cmdline: string; memoryParams: KernelMemParam[] }

export interface HardwareInfo {
  cpu: { model: string; vendor: string; cores: number; threads: number };
  memory: MemorySplit;
  gpus: GpuMemory[];
  firmware: FirmwareInfo;
  kernel: KernelInfo;
  sharedMemory: boolean;
  hints: string[];
}

// ── Core-Hub-Update: Quelle und auswählbare Stände ──
/** Konfigurierte Update-Quelle (Git-Repository) – ohne Token/Passwort. */
export interface UpdateSource {
  url: string;
  branch: string;
  visibility: 'public' | 'private';
  authType: 'token' | 'password';
  username: string;
  /** true, wenn ein Token/Passwort hinterlegt ist (der Wert selbst wird nie ausgeliefert). */
  hasSecret: boolean;
  configured: boolean;
  /** Im vorhandenen Checkout eingetragene origin-URL (Vorbelegung). */
  detectedUrl?: string;
  detectedBranch?: string;
  repoRoot?: string | null;
}

/** Ein auswählbarer Stand (neueste Version, Tag oder älterer Commit). */
export interface UpdateVersion {
  ref: string;
  type: 'branch' | 'tag' | 'commit';
  version: string;
  shortSha: string;
  date: string;
  subject: string;
  current: boolean;
  latest: boolean;
  author: string;
  /** Ausführlicher Text (Commit-Body bzw. Tag-Beschreibung) – kann leer sein. */
  body: string;
}

/** Eine geänderte Datei mit Zeilenbilanz. */
export interface UpdateChangedFile {
  path: string;
  added: number;
  deleted: number;
}

/** Ein einzelner Commit in den Änderungsnotizen. */
export interface UpdateCommit {
  sha: string;
  short: string;
  date: string;
  author: string;
  subject: string;
  body: string;
}

/** „Was bringt dieser Stand?" – Titel, Text, Commits und geänderte Dateien. */
export interface UpdateNotes {
  ref: string;
  sha: string;
  shortSha: string;
  version: string;
  date: string;
  author: string;
  subject: string;
  body: string;
  currentSha: string;
  currentVersion: string;
  direction: 'forward' | 'backward' | 'same' | 'diverged';
  commits: UpdateCommit[];
  truncated: boolean;
  files: UpdateChangedFile[];
  filesTruncated: boolean;
  insertions: number;
  deletions: number;
}

// ── Taskmanager: systemd-Dienste ──
export interface ServiceInfo {
  name: string;
  description: string;
  load: string;
  /** active | inactive | failed | activating … */
  active: string;
  /** running | exited | dead … */
  sub: string;
  /** enabled | disabled | static | masked | generated | '' */
  startup: string;
  /** true, wenn sich der Autostart umschalten lässt. */
  canToggleStartup: boolean;
}

export interface BootUnit {
  name: string;
  seconds: number;
  startup: string;
  /** Unit, die abgeschaltet werden muss – die Unit selbst oder ihr Timer/Socket. */
  toggleUnit?: string;
  toggleKind?: 'self' | 'trigger';
  /** 'enabled' = lässt sich abschalten, 'disabled' = lässt sich wieder einschalten. */
  toggleState?: 'enabled' | 'disabled';
  /** Erklärung, wenn sich nichts abschalten lässt. */
  note?: string;
}

export interface BootAnalysis {
  available: boolean;
  summary: string;
  totalSeconds: number;
  units: BootUnit[];
}

export type ServiceAction = 'start' | 'stop' | 'restart' | 'reload' | 'enable' | 'disable';

// ── Dateimanager ──
export interface FileEntry {
  name: string;
  /** Vollständiger Pfad – nur bei Suchergebnissen gesetzt. */
  path?: string;
  type: 'dir' | 'file' | 'link' | 'other';
  size: number;
  mtime: string;
  /** Rechte oktal, z. B. „755". */
  mode: string;
  /** Rechte lesbar, z. B. „rwxr-xr-x". */
  modeText: string;
  owner: string;
  group: string;
  target?: string;
}

export interface FileListing {
  path: string;
  parent: string | null;
  entries: FileEntry[];
}

export interface FileSearchResult {
  /** Ordner, ab dem gesucht wurde. */
  path: string;
  query: string;
  /** true, wenn die Obergrenze erreicht wurde und es mehr Treffer gäbe. */
  truncated: boolean;
  entries: FileEntry[];
}
