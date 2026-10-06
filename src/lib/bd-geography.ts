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
  chattagram: "Chattogram",
  barisal: "Barishal",
  comilla: "Cumilla",
  jessore: "Jashore",
  bogra: "Bogura",
  "coxs bazar": "Cox's Bazar",
  "cox bazar": "Cox's Bazar",
  coxsbazar: "Cox's Bazar",
  "chapai nawabganj": "Chapainawabganj",
  netrakona: "Netrokona",
  jhalakathi: "Jhalokati",
  jhalakati: "Jhalokati",
  maulvibazar: "Moulvibazar",
  narayangonj: "Narayanganj",
  kishorganj: "Kishoreganj",
  laxmipur: "Lakshmipur",
  khagrachari: "Khagrachhari",
  mymensing: "Mymensingh",
};

/**
 * Bangla names of the 64 districts, with common alternative spellings (FX-75, audit F23). Customers writing in Bangla
 * script couldn't get a delivery charge or place an order before this.
 */
export const BANGLA_DISTRICT_NAMES: Readonly<Record<string, readonly string[]>> = {
  Dhaka: ["ঢাকা"], Gazipur: ["গাজীপুর", "গাজিপুর"], Narayanganj: ["নারায়ণগঞ্জ", "নারায়নগঞ্জ"], Narsingdi: ["নরসিংদী", "নরসিংদি"],
  Tangail: ["টাঙ্গাইল", "টাংগাইল"], Kishoreganj: ["কিশোরগঞ্জ"], Manikganj: ["মানিকগঞ্জ"], Munshiganj: ["মুন্সীগঞ্জ", "মুন্সিগঞ্জ"],
  Faridpur: ["ফরিদপুর"], Gopalganj: ["গোপালগঞ্জ"], Madaripur: ["মাদারীপুর", "মাদারিপুর"], Rajbari: ["রাজবাড়ী", "রাজবাড়ি"],
  Shariatpur: ["শরীয়তপুর", "শরিয়তপুর"],
  Chattogram: ["চট্টগ্রাম"], "Cox's Bazar": ["কক্সবাজার", "কক্স বাজার"], Cumilla: ["কুমিল্লা"], Feni: ["ফেনী", "ফেনি"],
  Brahmanbaria: ["ব্রাহ্মণবাড়িয়া", "ব্রাহ্মনবাড়িয়া"], Noakhali: ["নোয়াখালী", "নোয়াখালি"], Lakshmipur: ["লক্ষ্মীপুর", "লক্ষীপুর"],
  Chandpur: ["চাঁদপুর"], Khagrachhari: ["খাগড়াছড়ি"], Rangamati: ["রাঙ্গামাটি", "রাঙামাটি"], Bandarban: ["বান্দরবান"],
  Rajshahi: ["রাজশাহী", "রাজশাহি"], Bogura: ["বগুড়া"], Pabna: ["পাবনা"], Sirajganj: ["সিরাজগঞ্জ"], Naogaon: ["নওগাঁ"],
  Natore: ["নাটোর"], Chapainawabganj: ["চাঁপাইনবাবগঞ্জ", "চাপাইনবাবগঞ্জ"], Joypurhat: ["জয়পুরহাট"],
  Khulna: ["খুলনা"], Jashore: ["যশোর"], Kushtia: ["কুষ্টিয়া"], Jhenaidah: ["ঝিনাইদহ"], Chuadanga: ["চুয়াডাঙ্গা", "চুয়াডাঙা"],
  Meherpur: ["মেহেরপুর"], Magura: ["মাগুরা"], Narail: ["নড়াইল"], Satkhira: ["সাতক্ষীরা"], Bagerhat: ["বাগেরহাট"],
  Barishal: ["বরিশাল"], Patuakhali: ["পটুয়াখালী", "পটুয়াখালি"], Bhola: ["ভোলা"], Pirojpur: ["পিরোজপুর"], Barguna: ["বরগুনা"],
  Jhalokati: ["ঝালকাঠি", "ঝালকাঠী"],
  Sylhet: ["সিলেট"], Moulvibazar: ["মৌলভীবাজার"], Habiganj: ["হবিগঞ্জ"], Sunamganj: ["সুনামগঞ্জ"],
  Rangpur: ["রংপুর"], Dinajpur: ["দিনাজপুর"], Gaibandha: ["গাইবান্ধা"], Kurigram: ["কুড়িগ্রাম"], Lalmonirhat: ["লালমনিরহাট"],
  Nilphamari: ["নীলফামারী", "নীলফামারি"], Panchagarh: ["পঞ্চগড়"], Thakurgaon: ["ঠাকুরগাঁও"],
  Mymensingh: ["ময়মনসিংহ"], Jamalpur: ["জামালপুর"], Netrokona: ["নেত্রকোণা", "নেত্রকোনা"], Sherpur: ["শেরপুর"],
};

// NFC first: Bangla ড় / য় have two encodings (one code point, or a letter plus nukta) and both appear in typed text.
// Then drop a trailing "district" word, punctuation and extra spaces.
const normalize = (name: string) =>
  name
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/[।,;:!?]+$/u, "")
    .replace(/\s*(?:জেলা|জেলার|district|zila|zilla)$/u, "")
    .replace(/['’.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
const BY_NAME = new Map(BD_64_DISTRICTS.map((x) => [normalize(x.district), x]));
for (const [district, names] of Object.entries(BANGLA_DISTRICT_NAMES)) {
  const spec = BY_NAME.get(normalize(district));
  if (spec) for (const n of names) BY_NAME.set(normalize(n), spec);
}

/**
 * The district by name (case-insensitive; old English spellings and Bangla names accepted), or undefined if it isn't one
 * of the 64.
 */
export function findDistrict(name: string | null | undefined): DistrictSpec | undefined {
  if (!name) return undefined;
  const key = normalize(name);
  return BY_NAME.get(key) ?? BY_NAME.get(normalize(ALIASES[key] ?? ""));
}
