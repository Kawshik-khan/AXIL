/** How a signed-in person is drawn in the navigation: initials on a colour of their own (users have no photo). */

/** The same colours on every visit: the hue comes from the name. */
export function avatarGradient(name: string): string {
  const hue = [...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
  return `linear-gradient(135deg, hsl(${hue} 62% 46%), hsl(${(hue + 48) % 360} 68% 34%))`;
}

export function initialsOf(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();
}

/** "SALES_MANAGER" → "Sales manager" */
export function roleLabelOf(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1).toLowerCase().replace(/_/g, " ");
}
