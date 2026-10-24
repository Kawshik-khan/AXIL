const fs = require('fs');
const content = fs.readFileSync('src/app/(dashboard)/connector/page.tsx', 'utf8');
const counts = {
  logisticsCount: (content.match(/configurations\.filter\(\(c\) => c\.category === "LOGISTICS"\)/g) || []).length,
  socialAdsCount: (content.match(/configurations\.filter\(\(c\) => c\.category === "SOCIAL_ADS"/g) || []).length,
  providersLogisticsCount: (content.match(/providers\.filter\(\(p\) => p\.category === "LOGISTICS"\)/g) || []).length,
  providersSocialAdsCount: (content.match(/providers\.filter\(\(p\) => p\.category === "SOCIAL_ADS"\)/g) || []).length,
  providersAILLMCount: (content.match(/providers\.filter\(\(p\) => p\.category === "AI_LLM"\)/g) || []).length,
  providersVectorDBCount: (content.match(/providers\.filter\(\(p\) => p\.category === "VECTOR_DB"\)/g) || []).length,
  providersEnterpriseCount: (content.match(/providers\.filter\(\(p\) => p\.category === "ENTERPRISE"\)/g) || []).length,
};
console.log(counts);
