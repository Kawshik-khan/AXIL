/**
 * Bangladesh's 64 districts by division, with the delivery zone each belongs to. Shared by server and client code
 * (no store access). Addresses use these names; the delivery zone and division are derived from the district, never
 * guessed (FX-36 M5: outside-Dhaka orders used to be stored as "Chittagong").
 */
import type { DeliveryZone } from "@/types/analytics";

export interface DistrictSpec {
  district: string;
  division: string;
  zone: DeliveryZone;
}

const d = (district: string, division: string, zone: DeliveryZone = "OUTSIDE_DHAKA"): DistrictSpec => ({ district, division, zone });

export const BD_64_DISTRICTS: DistrictSpec[] = [
  // Dhaka Division (13)
  d("Dhaka", "Dhaka", "INSIDE_DHAKA"), d("Gazipur", "Dhaka"), d("Narayanganj", "Dhaka"), d("Narsingdi", "Dhaka"),
  d("Tangail", "Dhaka"), d("Kishoreganj", "Dhaka"), d("Manikganj", "Dhaka"), d("Munshiganj", "Dhaka"),
  d("Faridpur", "Dhaka"), d("Gopalganj", "Dhaka"), d("Madaripur", "Dhaka"), d("Rajbari", "Dhaka"), d("Shariatpur", "Dhaka"),
  // Chattogram Division (11)
  d("Chattogram", "Chattogram"), d("Cox's Bazar", "Chattogram"), d("Cumilla", "Chattogram"), d("Feni", "Chattogram"),
  d("Brahmanbaria", "Chattogram"), d("Noakhali", "Chattogram"), d("Lakshmipur", "Chattogram"), d("Chandpur", "Chattogram"),
  d("Khagrachhari", "Chattogram"), d("Rangamati", "Chattogram"), d("Bandarban", "Chattogram"),
  // Rajshahi Division (8)
  d("Rajshahi", "Rajshahi"), d("Bogura", "Rajshahi"), d("Pabna", "Rajshahi"), d("Sirajganj", "Rajshahi"),
  d("Naogaon", "Rajshahi"), d("Natore", "Rajshahi"), d("Chapainawabganj", "Rajshahi"), d("Joypurhat", "Rajshahi"),
  // Khulna Division (10)
  d("Khulna", "Khulna"), d("Jashore", "Khulna"), d("Kushtia", "Khulna"), d("Jhenaidah", "Khulna"), d("Chuadanga", "Khulna"),
  d("Meherpur", "Khulna"), d("Magura", "Khulna"), d("Narail", "Khulna"), d("Satkhira", "Khulna"), d("Bagerhat", "Khulna"),
  // Barishal Division (6)
  d("Barishal", "Barishal"), d("Patuakhali", "Barishal"), d("Bhola", "Barishal"), d("Pirojpur", "Barishal"),
  d("Barguna", "Barishal"), d("Jhalokati", "Barishal"),
  // Sylhet Division (4)
  d("Sylhet", "Sylhet"), d("Moulvibazar", "Sylhet"), d("Habiganj", "Sylhet"), d("Sunamganj", "Sylhet"),
  // Rangpur Division (8)
  d("Rangpur", "Rangpur"), d("Dinajpur", "Rangpur"), d("Gaibandha", "Rangpur"), d("Kurigram", "Rangpur"),
  d("Lalmonirhat", "Rangpur"), d("Nilphamari", "Rangpur"), d("Panchagarh", "Rangpur"), d("Thakurgaon", "Rangpur"),
  // Mymensingh Division (4)
  d("Mymensingh", "Mymensingh"), d("Jamalpur", "Mymensingh"), d("Netrokona", "Mymensingh"), d("Sherpur", "Mymensingh"),
];

export const BD_DIVISIONS: string[] = Array.from(new Set(BD_64_DISTRICTS.map((x) => x.division)));

/** Older English spellings still common in addresses. */
const ALIASES: Record<string, string> = {
  chittagong: "Chattogram",
  barisal: "Barishal",
  comilla: "Cumilla",
  jessore: "Jashore",
  bogra: "Bogura",
  "coxs bazar": "Cox's Bazar",
  "cox bazar": "Cox's Bazar",
  "chapai nawabganj": "Chapainawabganj",
  netrakona: "Netrokona",
  jhalakathi: "Jhalokati",
  maulvibazar: "Moulvibazar",
};

const normalize = (name: string) => name.trim().toLowerCase().replace(/['’.]/g, "").replace(/\s+/g, " ");
const BY_NAME = new Map(BD_64_DISTRICTS.map((x) => [normalize(x.district), x]));

/** The district by name (case-insensitive, old spellings accepted), or undefined if it isn't one of the 64. */
export function findDistrict(name: string | null | undefined): DistrictSpec | undefined {
  if (!name) return undefined;
  const key = normalize(name);
  return BY_NAME.get(key) ?? BY_NAME.get(normalize(ALIASES[key] ?? ""));
}
