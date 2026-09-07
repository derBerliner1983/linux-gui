import { LayoutDashboard, TerminalSquare, Settings, Activity, FolderTree, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  icon: LucideIcon;
  labelKey: string;
}

export interface NavSection {
  labelKey: string;
  items: NavItem[];
  /** true = Abschnitt erscheint nur, wenn die zugehörige Funktion installiert ist. */
  optional?: boolean;
}

/**
 * Navigations-Struktur der Seitenleiste. Wird sowohl von der Sidebar als auch
 * von den Einstellungen (Ein-/Ausblenden von Menüpunkten) verwendet.
 */
export const NAV: NavSection[] = [
  {
    labelKey: 'nav.section.overview',
    items: [
      { to: '/dashboard', icon: LayoutDashboard, labelKey: 'nav.dashboard' },
      { to: '/taskmanager', icon: Activity, labelKey: 'nav.taskmanager' },
      { to: '/terminal', icon: TerminalSquare, labelKey: 'nav.terminal' },
      { to: '/files', icon: FolderTree, labelKey: 'nav.files' },
      { to: '/antivirus', icon: ShieldCheck, labelKey: 'nav.antivirus' },
      { to: '/settings', icon: Settings, labelKey: 'nav.settings' },
    ],
  },
];

/**
 * Menüpunkte, die nicht ausgeblendet werden dürfen – sonst käme man an die
 * Einstellungen (und damit an das Wieder-Einblenden) nicht mehr heran.
 */
export const ALWAYS_VISIBLE = ['/dashboard', '/settings'];

/** Pref-Schlüssel für die Liste der ausgeblendeten Menüpunkte. */
export const HIDDEN_NAV_PREF = 'hiddenNav';

export function canHide(to: string): boolean {
  return !ALWAYS_VISIBLE.includes(to);
}

/** Alle Menüpunkte flach – praktisch für die Einstellungen. */
export function allNavItems(): NavItem[] {
  return NAV.flatMap((s) => s.items);
}
