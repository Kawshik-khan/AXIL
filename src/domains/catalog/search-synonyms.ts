/**
 * Catalog search words for Bangladeshi shoppers: Banglish, Bangla and English names of common product types and colours,
 * and filler words that carry no product meaning (FX-74, audit F11). Shared by the customer agent and, later, the
 * dashboard search. Matching is by tokens: every query word must name the product, in any of its spellings.
 */

const STOPWORDS = new Set([
  "ache", "ase", "achhe", "ki", "koto", "dam", "price", "er", "ar", "vai", "bhai", "apnader", "do", "you", "have", "the",
  "a", "is", "size", "e", "te", "kemon", "dao", "den", "chai", "nibo", "of", "in", "for", "any", "what", "how", "much",
  "কত", "দাম", "আছে", "কি", "চাই", "সাইজ",
]);

/** Canonical word → every spelling that means it. */
export const SEARCH_SYNONYMS: Record<string, string[]> = {
  tshirt: ["t-shirt", "tshirt", "t shirt", "tee", "genji", "গেঞ্জি", "টি-শার্ট", "টিশার্ট"],
  panjabi: ["panjabi", "punjabi", "panjabee", "পাঞ্জাবি", "পাঞ্জাবী"],
  shoes: ["shoe", "shoes", "juta", "জুতা", "oxford"],
  saree: ["saree", "sari", "shari", "শাড়ি", "jamdani", "জামদানি"],
  jeans: ["jeans", "jeens", "denim", "জিন্স", "pant"],
  hijab: ["hijab", "hejab", "হিজাব"],
  frock: ["frock", "frok", "ফ্রক"],
  wallet: ["wallet", "manibag", "moneybag", "ওয়ালেট", "মানিব্যাগ"],
  kurti: ["kurti", "kurta", "কুর্তি"],
  watch: ["watch", "ghori", "ঘড়ি", "smartwatch"],
  black: ["black", "blak", "kalo", "কালো"],
  white: ["white", "sada", "সাদা"],
};

/** Colour words: they narrow a search but never name a product on their own. */
export const COLOUR_WORDS = new Set(["black", "white"]);

const SPELLINGS: Array<[string, Set<string>]> = Object.entries(SEARCH_SYNONYMS).map(([key, list]) => [
  key,
  new Set(list.map((s) => s.normalize("NFC").toLowerCase().replace(/[\s-]/g, ""))),
]);

function canon(token: string): string {
  const t = token.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}-]/gu, "");
  const bare = t.replace(/-/g, "");
  const forms = [bare, bare.replace(/s$/, "")]; // "t-shirts" → "tshirt"
  for (const [key, spellings] of SPELLINGS) if (forms.some((f) => spellings.has(f))) return key;
  return t;
}

/** The meaningful, canonical words of a query or a product text. */
export function searchTokens(text: string): string[] {
  const raw = text
    .normalize("NFC")
    .toLowerCase()
    .replace(/t[\s-]?shirt/g, "tshirt")
    .replace(/টি[\s-]?শার্ট/g, "tshirt")
    .split(/[\s,./?!()।]+/)
    .filter(Boolean);
  return raw.map(canon).filter((t) => t && !STOPWORDS.has(t));
}
