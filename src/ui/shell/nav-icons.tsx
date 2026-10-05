import { ChartGantt, Clock, FileText, PackageCheck, FolderKanban, LayoutDashboard, Settings, Truck, Users } from "lucide-react";

export const NAV_ICONS = {
  dashboard: LayoutDashboard,
  projects: FolderKanban,
  time: Clock,
  takt: ChartGantt,
  logistics: PackageCheck,
  workforce: Users,
  equipment: Truck,
  documents: FileText,
  settings: Settings,
} as const;

export type NavKey = keyof typeof NAV_ICONS;
