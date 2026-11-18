// Keyword/regex intent router used when Gemini is unavailable ("basic mode").
// Keywords for all 5 languages are always checked, since farmers often mix languages in one message.

const KEYWORDS = {
  fertilizer: [
    /fertili[sz]er|manure|urea|\bdap\b|\bmop\b|\bnpk\b|nutrient|potash|compost/i,
    /खाद|उर्वरक|यूरिया|डीएपी|पोटाश/, // hi
    /ఎరువు|యూరియా|పోషక/, // te
    /உரம்|உரங்கள்|யூரியா/, // ta
    /ಗೊಬ್ಬರ|ರಸಗೊಬ್ಬರ|ಯೂರಿಯಾ/, // kn
  ],
  disease: [
    /disease|infect|blight|fung|mildew|\brust\b|\brot\b|spots?\b|pest|insect|leaf|leaves|yellowing|wilt|sick/i,
    /रोग|बीमारी|कीट|कीड़|पत्ती|पत्ते|धब्बे|फफूंद/, // hi
    /వ్యాధి|తెగులు|పురుగు|ఆకు|మచ్చ/, // te
    /நோய்|பூச்சி|இலை|புள்ளி|பூஞ்சை/, // ta
    /ರೋಗ|ಕೀಟ|ಎಲೆ|ಚುಕ್ಕೆ|ಶಿಲೀಂಧ್ರ/, // kn
  ],
  weather: [
    /weather|rain|forecast|temperature|humid|climate|storm|monsoon/i,
    /मौसम|बारिश|वर्षा|तापमान|आंधी/, // hi
    /వాతావరణం|వర్షం|ఉష్ణోగ్రత/, // te
    /வானிலை|மழை|வெப்பநிலை/, // ta
    /ಹವಾಮಾನ|ಮಳೆ|ತಾಪಮಾನ/, // kn
  ],
  crop: [
    /\bcrops?\b|which .*grow|what .*(grow|sow|plant)|cultivat|sowing/i,
    /फसल|बुवाई|बोना|बोएं|उगा/, // hi
    /పంట|సాగు|విత్తు/, // te
    /பயிர்|சாகுபடி|விதை/, // ta
    /ಬೆಳೆ|ಬಿತ್ತನೆ|ಬೆಳೆಯ/, // kn
  ],
};

export function detectIntent(message = '', hasImage = false) {
  if (hasImage) return 'disease';
  const matches = (intent) => KEYWORDS[intent].some((re) => re.test(message));
  if (matches('fertilizer')) return 'fertilizer';
  if (matches('disease')) return 'disease';
  // Soil test numbers mean a crop question, even when "season" is mentioned: in Hindi "मौसम" means
  // both "season" and "weather" ("इस मौसम में कौन सी फसल" = "which crop this season").
  const soil = extractSoil(message);
  const hasSoil = soil.N != null && soil.P != null && soil.K != null;
  if (hasSoil || (matches('crop') && matches('weather') && /फसल|crop/i.test(message))) return 'crop';
  if (matches('weather')) return 'weather';
  if (matches('crop')) return 'crop';
  return 'unknown';
}

// --- value extraction -----------------------------------------------------------------------------

const NUM = String.raw`\s*(?:[:=-]|is|of)?\s*(\d+(?:\.\d+)?)`;
const PATTERNS = {
  N: [new RegExp(String.raw`\b(?:N|nitrogen)${NUM}`, 'i'), new RegExp(`(?:नाइट्रोजन|నత్రజని|நைட்ரஜன்|ಸಾರಜನಕ)${NUM}`)],
  P: [new RegExp(String.raw`\b(?:P|phosphorus|phosphorous)${NUM}`, 'i'), new RegExp(`(?:फास्फोरस|फॉस्फोरस|భాస్వరం|பாஸ்பரஸ்|ರಂಜಕ)${NUM}`)],
  K: [new RegExp(String.raw`\b(?:K|potassium)${NUM}`, 'i'), new RegExp(`(?:पोटैशियम|पोटेशियम|పొటాషియం|பொட்டாசியம்|ಪೊಟ್ಯಾಸಿಯಮ್)${NUM}`)],
  ph: [new RegExp(String.raw`\bp\s*\.?\s*h${NUM}`, 'i'), new RegExp(`(?:पीएच|పీహెచ్|பிஎச்|ಪಿಎಚ್)${NUM}`)],
};

export function extractSoil(message = '') {
  const out = {};
  for (const [key, regexes] of Object.entries(PATTERNS)) {
    for (const re of regexes) {
      const m = message.match(re);
      if (m) {
        out[key] = Number(m[1]);
        break;
      }
    }
  }
  return out;
}

// Crop names the fertilizer endpoint understands (English + common local names in all 5 scripts).
const CROP_WORDS = {
  rice: /\brice\b|\bpaddy\b|धान|चावल|వరి|நெல்|ಭತ್ತ/i,
  maize: /\bmaize\b|\bcorn\b|मक्का|మొక్కజొన్న|மக்காச்சோளம்|ಮೆಕ್ಕೆಜೋಳ/i,
  chickpea: /chick\s?pea|\bchana\b|\bgram\b|चना|శనగ|கொண்டைக்கடலை|ಕಡಲೆ/i,
  kidneybeans: /kidney\s?beans?|rajma|राजमा/i,
  pigeonpeas: /pigeon\s?peas?|\barhar\b|\btoor\b|\btur\b|अरहर|तुअर|కంది|துவரை|ತೊಗರಿ/i,
  mothbeans: /moth\s?beans?|मोठ/i,
  mungbean: /mung\s?beans?|moong|मूंग|పెసర|பாசிப்பயறு|ಹೆಸರು/i,
  blackgram: /black\s?gram|\burad\b|उड़द|उडद|మినుము|உளுந்து|ಉದ್ದು/i,
  lentil: /lentils?|masoor|मसूर/i,
  pomegranate: /pomegranate|अनार|దానిమ్మ|மாதுளை|ದಾಳಿಂಬೆ/i,
  banana: /banana|केला|అరటి|வாழை|ಬಾಳೆ/i,
  mango: /mango|आम|మామిడి|மாம்பழம்|மா\b|ಮಾವು/i,
  grapes: /grapes?|अंगूर|ద్రాక్ష|திராட்சை|ದ್ರಾಕ್ಷಿ/i,
  watermelon: /water\s?melon|तरबूज|పుచ్చ|தர்பூசணி|ಕಲ್ಲಂಗಡಿ/i,
  muskmelon: /musk\s?melon|खरबूजा|కర్బూజ|முலாம்பழம்|ಕರಬೂಜ/i,
  apple: /\bapples?\b|सेब|ఆపిల్|ஆப்பிள்|ಸೇಬು/i,
  orange: /\boranges?\b|संतरा|నారింజ|ஆரஞ்சு|ಕಿತ್ತಳೆ/i,
  papaya: /papaya|पपीता|బొప్పాయి|பப்பாளி|ಪಪ್ಪಾಯಿ/i,
  coconut: /coconut|नारियल|కొబ్బరి|தென்னை|தேங்காய்|ತೆಂಗು/i,
  cotton: /cotton|कपास|పత్తి|பருத்தி|ಹತ್ತಿ/i,
  jute: /\bjute\b|जूट|पटसन|జనుము|சணல்|ಸೆಣಬು/i,
  coffee: /coffee|कॉफी|కాఫీ|காபி|ಕಾಫಿ/i,
};

export function extractCrop(message = '') {
  for (const [crop, re] of Object.entries(CROP_WORDS)) if (re.test(message)) return crop;
  return null;
}

/** City name after "in"/"at"/"for" (English), or "<city> में/का" (Hindi). Best effort only. */
export function extractCity(message = '') {
  const en = message.match(/\b(?:in|at|for)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/);
  if (en) return en[1];
  const hi = message.match(/([ऀ-ॿ]+)\s+(?:में|का|की)\s+मौसम/);
  return hi ? hi[1] : null;
}
