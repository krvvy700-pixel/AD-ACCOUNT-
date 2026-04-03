// =============================================================
// SPAM & FAKE COMMENT DETECTION — Keyword-based filtering
// =============================================================

const SPAM_WORDS = new Set([
  'fraud', 'scam', 'fake', 'scammer', 'scamming', 'cheater', 'cheating',
  'chor', 'chori', 'loot', 'dhoka', 'dhokha', 'dhokebaaz', 'dhokhebaaz',
  'beware', 'harami', 'bakwas', 'faltu', 'waste', 'spam', 'fraudsters',
  'cheaters', 'looting', 'unsafe', 'misleading', 'denied', 'blocked',
]);

const SPAM_PHRASES = [
  'cod fraud', 'cod scam', 'cod not available', 'cod denied',
  'return not available', 'no return', 'no exchange', 'return not accepted',
  'comments deleted', 'negative comments hidden', 'blocking customers',
  'blocked after payment', 'account blocked', 'review delete',
  'fake reviews', 'paid reviews', 'comments are being deleted',
  'legal action', 'consumer court', 'consumer complaint', 'police complaint',
  'cyber crime', 'complaint filed', 'fir karunga', 'case filed', 'case karunga',
  'chor company', 'lootne wali company', 'fraud company', 'scam company',
  'cheating company', 'bewakoof bana rahe', 'public ko loot', 'customers ko loot',
  'bakwas brand', 'faltu brand', 'waste brand',
  'time waste', 'money waste', 'dont buy', 'do not buy', 'never buy',
  'avoid this', 'dont trust', 'never trust', 'stay away', 'stay alert',
  'alert everyone', 'mat lena', 'mat kharidna', 'koi order mat karo',
  'paise mat do', 'not trusted', 'not recommended',
  'no response', 'no reply', 'no customer support', 'customer care not responding',
  'support not working', 'helpdesk useless', 'phone switched off',
  'number not reachable', 'number fake', 'email not responding', 'email fake',
  'dm seen no reply', 'whatsapp no reply', 'contact number not working',
  'wrong product', 'wrong item', 'different product received',
  'duplicate product', 'used product', 'old product', 'damaged product',
  'broken product', 'cheap product', 'cheap quality', 'low quality',
  'bad quality', 'third class quality', 'worst quality', 'bakwas quality',
  'local product', 'duplicate maal', 'cheap damaged product',
  'payment done but no order', 'payment done no response', 'paid but no reply',
  'prepaid fraud', 'prepaid scam', 'money gone', 'money lost', 'money wasted',
  'paise doob gaye', 'lost my money',
  'refund nahi mila', 'refund pending', 'refund delay', 'refund scam',
  'refund fake', 'refund not received', 'no refund', 'refund refused',
  'order not received', 'order nahi aaya', 'order nahi mila', 'order pending',
  'order still pending', 'order delay', 'order delayed', 'order stuck',
  'order cancelled without reason', 'order confirmed but not delivered',
  'parcel not received', 'parcel nahi mila', 'parcel lost', 'parcel never arrived',
  'delivery nahi hui', 'delivery pending', 'delivery delayed', 'late delivery',
  'no delivery', 'fake delivery status', 'fake delivery promise',
  'tracking fake', 'tracking not working', 'tracking id not shared',
  'fake business', 'fake deal', 'fake marketing', 'fake commitment',
  'fake seller', 'fake owner', 'fake brand', 'fake company',
  'fake website', 'fake page', 'fake store', 'fake app', 'fake ads',
  'fake offer', 'fake promise', 'false promise', 'misleading ads',
  'fraud page', 'scam page', 'scam website', 'fake site', 'fake account',
  'big time fraud', 'total scam', 'completely fake',
  'dont trust this page', 'dont order from here', 'dont fall for this trap',
  'buyers beware', 'public warning', 'scam alert', 'fraud alert',
  'this website is a scam', 'fraud page don\'t buy',
  'cyber crime complaint filed', 'consumer court complaint done',
];

export function detectSpam(text) {
  if (!text || typeof text !== 'string') return { isSpam: false, matchedKeywords: [], score: 0 };
  const lower = text.toLowerCase().trim();
  const matchedKeywords = [];
  let score = 0;

  const words = lower.split(/\s+/);
  for (const word of words) {
    const clean = word.replace(/[^a-z0-9]/g, '');
    if (SPAM_WORDS.has(clean)) { matchedKeywords.push(clean); score += 1; }
  }

  for (const phrase of SPAM_PHRASES) {
    if (lower.includes(phrase)) { matchedKeywords.push(phrase); score += 2; }
  }

  const unique = [...new Set(matchedKeywords)];
  return { isSpam: score >= 2, matchedKeywords: unique, score };
}
