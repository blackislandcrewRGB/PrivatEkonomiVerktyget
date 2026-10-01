import { memo, useState, type CSSProperties } from "react";
import { User } from "lucide-react";
import type { IconRef } from "../api";
import { BRAND_ICONS } from "../generated/brandIcons";
import { cn } from "../lib/cn";
import { contrast, iconIdentity, mix, monogram } from "../lib/monogram";

/** 36 in Transaktioner's list, 32 in Fasta utgifter's, 28 in its panel, 26 in the rules, 24 in the other lists and cards, 20 where the row is tight, 14 in the calendar's chips, 40 only as the preview where a picture is chosen. */
export type IconSize = 14 | 20 | 24 | 26 | 28 | 32 | 36 | 40 | 48;

const FONT: Record<IconSize, string> = { 14: "text-[8px]", 20: "text-[9px]", 24: "text-[11px]", 26: "text-[11px]", 28: "text-[12px]", 32: "text-[12px]", 36: "text-[13px]", 40: "text-sm", 48: "text-base" };

/** The neutral badge (--surface-muted) in each theme, for the brand colour's contrast. */
const BADGE = { light: "#f1f5f9", dark: "#1a1e26" };
/** WCAG's minimum for graphics against what is next to them. */
const GRAPHIC_CONTRAST = 3;
/** How much of the merchant's own colour the plate gets, per theme. */
const PLATE = { light: 0.16, dark: 0.26 };

/**
 * The plate behind a picture or a brand mark: the merchant's own colour (the
 * one its monogram would have) laid thinly over the neutral badge, so an icon
 * carries the same colour as the monogram it replaced. Grey when there is no
 * merchant to take a colour from (a Swish number without a contact).
 */
export function plateColors(name: string | null): { light: string; dark: string } {
  if (!name) return BADGE;
  const own = monogram(name).background;
  return { light: mix(own, BADGE.light, PLATE.light), dark: mix(own, BADGE.dark, PLATE.dark) };
}

/**
 * A brand's colour on the plate behind it, per theme: its own when it stands
 * out enough there, else the theme's text colour (Apple's black in the dark
 * theme). The plate is tinted, so the contrast is measured against the tint.
 */
export function brandColors(hex: string, plate: { light: string; dark: string } = BADGE): { light: string; dark: string } {
  const pick = (badge: string) => (contrast(hex, badge) >= GRAPHIC_CONTRAST ? hex : "var(--foreground)");
  return { light: pick(plate.light), dark: pick(plate.dark) };
}

export interface MerchantIconProps {
  /** The row's own name: wins over the bank's text for the monogram, it is what the list shows. */
  label?: string | null;
  /** A Swish number's contact. */
  contact?: string | null;
  /** The bank's text. */
  text?: string | null;
  /** From the server: an uploaded image or a brand. */
  icon?: IconRef | null;
  size?: IconSize;
  /** Next to the name written out: hidden from screen readers, so a row isn't read as 'Hyra Hyra'. */
  decorative?: boolean;
  /** Round (the default) or Design v2's rounded square (10 px corners). */
  shape?: "round" | "square";
  className?: string;
}

/**
 * A merchant's icon, first of: an uploaded image, a bundled brand icon
 * (simple-icons, in the brand's colour on a neutral badge), the monogram (a
 * grey person for a Swish without a contact). Round, never larger than the
 * row; read out as the merchant's name, never a file name.
 */
export const MerchantIcon = memo(function MerchantIcon({ label, contact, text, icon, size = 20, decorative = false, shape = "round", className }: MerchantIconProps) {
  // The image that failed to load (removed, say): drawn as the next level instead.
  const [failed, setFailed] = useState<string | null>(null);
  const who = iconIdentity({ label, contact, text });
  const name = who.kind === "monogram" ? who.name : text?.trim() || "Swish";
  const a11y = decorative ? { "aria-hidden": true as const } : { role: "img", "aria-label": name };
  const box = cn("inline-flex shrink-0 select-none items-center justify-center overflow-hidden", shape === "square" ? "rounded-[10px]" : "rounded-full", className);
  const dims = { width: size, height: size };
  // The merchant's own colour, thinly, behind a picture or a brand mark.
  const plate = plateColors(who.kind === "monogram" ? who.name : null);
  const plated = { "--plate-light": plate.light, "--plate-dark": plate.dark } as CSSProperties;
  const plateClass = "bg-[var(--plate-light)] dark:bg-[var(--plate-dark)]";

  if (icon?.image && failed !== icon.image) {
    return (
      // The <img> itself carries the name (alt), the badge around it nothing.
      <span aria-hidden={decorative || undefined} data-merchant-icon="image" className={cn(box, plateClass)} style={{ ...dims, ...plated }}>
        <img src={icon.image} alt={decorative ? "" : name} onError={() => setFailed(icon.image!)} className="size-[88%] object-contain" draggable={false} />
      </span>
    );
  }
  const brand = icon?.brand ? BRAND_ICONS[icon.brand] : undefined;
  if (brand) {
    const colors = brandColors(brand.hex, plate);
    return (
      <span
        {...a11y}
        data-merchant-icon={`brand:${icon!.brand}`}
        className={cn(box, plateClass, "text-[var(--brand-light)] dark:text-[var(--brand-dark)]")}
        style={{ ...dims, ...plated, "--brand-light": colors.light, "--brand-dark": colors.dark } as CSSProperties}
      >
        <svg viewBox="0 0 24 24" aria-hidden fill="currentColor" style={{ width: size * 0.64, height: size * 0.64 }}>
          <path d={brand.path} />
        </svg>
      </span>
    );
  }
  if (who.kind === "person") {
    return (
      <span {...a11y} data-merchant-icon="person" className={cn(box, "bg-surface-muted text-muted ring-1 ring-border ring-inset")} style={dims}>
        <User aria-hidden style={{ width: size * 0.6, height: size * 0.6 }} />
      </span>
    );
  }
  const m = monogram(who.name);
  return (
    <span
      {...a11y}
      data-merchant-icon={`monogram:${who.name}`}
      className={cn(box, "font-semibold leading-none tracking-tight", FONT[size])}
      style={{ ...dims, background: m.background, color: m.color }}
    >
      <span aria-hidden>{size < 16 ? m.text.slice(0, 1) : m.text}</span>
    </span>
  );
});
