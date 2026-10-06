/* Birr Ledger: reads Ethiopian bank and wallet SMS into transactions.
   Works on one message or many pasted together. No network, no dependencies. */
(function (root) {
  "use strict";

  const CATS = [
    { id: "food", label: "Food & groceries", kw: /supermarket|market|\bmart\b|grocer|shoa|queens|caf[eé]|restaurant|food|bakery|pizza|burger|kitchen|butcher|fruit|juice|coffee|hotel|lounge|meal|lunch|dinner|breakfast/i },
    { id: "transport", label: "Transport & fuel", kw: /\bride\b|feres|zayride|yango|taxi|fuel|petrol|benzine|total ?energies|\bnoc\b|oil libya|\bbus\b|transport|parking|ethiopian airlines|flight/i },
    { id: "airtime", label: "Airtime & internet", kw: /airtime|package|top ?up|\bdata\b|ethio ?telecom|safaricom|internet|wifi|mobile card/i },
    { id: "bills", label: "Bills & utilities", kw: /electric|\beeu\b|\bpower\b|water|aawsa|dstv|canal|\bbill\b|utility|subscription/i },
    { id: "rent", label: "Rent & housing", kw: /\brent\b|house|landlord|condominium|kebele|apartment/i },
    { id: "health", label: "Health", kw: /pharma|clinic|hospital|medical|health|laboratory|dental|medicine/i },
    { id: "education", label: "Education", kw: /school|tuition|university|college|academy|course|training|books?\b/i },
    { id: "shopping", label: "Shopping", kw: /\bshop\b|store|boutique|cloth|fashion|electronic|\bmall\b|shoes/i },
    { id: "cash", label: "Cash withdrawal", kw: /\batm\b|withdraw/i },
    { id: "savings", label: "Savings & equb", kw: /equb|iqub|saving|invest|shares?\b/i },
    { id: "people", label: "Family & people" },
    { id: "other", label: "Other spending" },
    { id: "salary", label: "Salary", kw: /salary|payroll|\bwage/i, income: true },
    { id: "received", label: "Received from people", income: true },
    { id: "income_other", label: "Other income", income: true },
    { id: "own", label: "Between my accounts", neutral: true }
  ];

  const STRONG = [
    ["CBE", /banking with cbe|cbe\.com\.et/i],
    ["telebirr", /using telebirr|e-money account|telebirr\.et|ethiotelecom\.et/i],
    ["CBE Birr", /cbe ?birr/i]
  ];
  const WEAK = [
    ["CBE Birr", /cbe ?birr/i],
    ["telebirr", /telebirr|\b127\b/i],
    ["CBE", /\bcbe\b|commercial bank of ethiopia/i],
    ["CBO", /cooperative bank|coopay|\bcoop\b|\bcbo\b/i],
    ["Awash", /awash/i], ["Dashen", /dashen|amole/i], ["BoA", /abyssinia|\bboa\b|apollo/i],
    ["Amhara Bank", /amhara bank/i], ["Wegagen", /wegagen/i], ["Hibret", /hibret|united bank/i],
    ["Nib", /\bnib\b/i], ["Zemen", /zemen/i], ["Oromia Bank", /oromia bank|oromia international/i],
    ["Bunna", /bunna/i], ["Berhan", /berhan/i], ["Abay", /abay bank/i], ["Enat", /enat bank/i],
    ["Siinqee", /siinqee/i], ["Ahadu", /ahadu/i], ["Gadaa", /gadaa/i], ["M-PESA", /m-?pesa|safaricom/i]
  ];
  const BANK_NAMES = Array.from(new Set(WEAK.map(b => b[0]))).concat(["Cash", "Other"]);

  function detectBank(text, sender) {
    if (sender) {
      if (/^\s*127\s*$/.test(sender)) return "telebirr";
      for (const [n, re] of WEAK) if (re.test(sender)) return n;
    }
    for (const [n, re] of STRONG) if (re.test(text)) return n;
    for (const [n, re] of WEAK) if (re.test(text)) return n;
    return "Other";
  }

  const num = s => parseFloat(String(s).replace(/,/g, ""));
  const round2 = n => Math.round(n * 100) / 100;
  const pad = n => String(n).padStart(2, "0");
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  function validDate(y, m, d, today) {
    if (y < 100) y += 2000;
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    const k = y + "-" + pad(m) + "-" + pad(d);
    const t = today || new Date().toISOString().slice(0, 10);
    const lower = (parseInt(t.slice(0, 4), 10) - 3) + t.slice(4);
    return k <= t && k >= lower ? k : null;
  }

  function findDate(t, today) {
    let m, k;
    if ((m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)) && (k = validDate(+m[1], +m[2], +m[3], today))) return k;
    if ((m = t.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})\b/)) && (k = validDate(+m[3], +m[2], +m[1], today))) return k;
    if ((m = t.match(/\b(\d{1,2})[\s\-]([A-Za-z]{3})[a-z]*[\s\-,]+(\d{4}|\d{2})\b/)) && MON[m[2].toLowerCase()] && (k = validDate(+m[3], MON[m[2].toLowerCase()], +m[1], today))) return k;
    if ((m = t.match(/\b([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})\b/)) && MON[m[1].toLowerCase()] && (k = validDate(+m[3], MON[m[1].toLowerCase()], +m[2], today))) return k;
    return null;
  }

  const AMT = /(?:ETB|Birr|Br\.?)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)|([0-9][0-9,]*\.[0-9]{2})\s*(?:ETB|Birr|Br\b)/gi;
  const NOT_PRINCIPAL = /(balance|charge|fee|vat|commission|levy|disaster|total|tax)[^0-9]{0,30}$/i;
  const IN = /\b(credited|you have received|received ETB|has been deposited|deposited (?:to|in)to? your|cash deposit|incoming transfer|refund(?:ed)?)\b/i;
  const OUT = /\b(debited|transferred|you have paid|paid ETB|have paid|withdrawn|withdrawal|purchased|you have sent|have sent|bought|payment of|been charged)\b/i;
  const BUSINESS = /\b(plc|p\.l\.c|s\.c|share company|company|enterprise|trading|import|export|supermarket|market|hotel|cafe|restaurant|pharmacy|clinic|hospital|school|academy|university|bank|telecom|station|shop|store|services?|solutions?|consult\w*|ltd|inc|org\w*|ministry|agency|office|association|church|mosque|ride|airlines)\b/i;

  function clean(s) {
    return (s || "").replace(/\s+/g, " ").replace(/^[\s,.:;\-]+|[\s,.:;\-]+$/g, "").slice(0, 60);
  }

  function findParty(t, dir) {
    const tries = dir === "out" ? [
      /to account\s*[\dxX*]+\s*\(([^)]+)\)/i,
      /\bto\s+([A-Z][A-Za-z.'&\- ]{1,60}?)\s*\((?:\+?251|0|[0-9*xX]{4,})/,
      /purchased (?:from|at)\s+([A-Za-z][\w.'&\- ]{1,50}?)(?=\s+on\b|[.,]|$)/i,
      /(?:merchant|beneficiary|receiver|payee)\s*(?:name)?\s*(?:is|:|-)?\s*([A-Za-z][\w.'&\- ]{1,50}?)(?=[.,;(]|\s+on\b|$)/i,
      /\bto\s+([A-Z][A-Za-z0-9.'&\- ]{1,50}?)(?=\s+(?:for|on|with|at|via|from|account|acc)\b|\s*[.,(]|$)/,
      /\bat\s+(ATM[A-Za-z0-9 \-]{0,30}?)(?=\s+on\b|[.,]|$)/
    ] : [
      /from account\s*[\dxX*]+\s*\(([^)]+)\)/i,
      /\bfrom\s+([A-Z][A-Za-z0-9.'&\- ]{1,60}?)\s*(?=\(|,|\s+on\b|\s+with\b|\s+to\b|\s+at\b|\.\s|\.$|$)/,
      /(?:sender|sent by|by)\s*(?::|-)?\s*([A-Z][\w.'&\- ]{1,50}?)(?=[.,;(]|\s+on\b|$)/
    ];
    for (const re of tries) {
      const m = t.match(re);
      if (!m) continue;
      const p = clean(m[1]);
      if (p && !/^(your|the|my|account|acc|a|an|this)\b/i.test(p) && p.length > 1) return p;
    }
    return "";
  }

  function findPurpose(t) {
    let m = t.match(/(?:reason|remark|narrative|purpose|description|details|memo)\s*(?:is|:|-|=)?\s*["']?([^.\n"']{2,60})/i);
    if (m && !/feedback/i.test(m[1])) return clean(m[1].replace(/\s+on\s+\d.*$/i, ""));
    m = t.match(/\bfor\s+((?:airtime|package|goods|bill|school|rent|fuel|data|internet|electric\w*|water|tuition|fees?|salary|loan|equb|medical|food|transport)\b[^.,\n]{0,40})/i);
    return m ? clean(m[1].replace(/\s+on\s+\d.*$/i, "")) : "";
  }

  function findKind(t, dir) {
    if (/\batm\b|withdraw/i.test(t)) return "cash";
    if (/airtime|top ?up|data bundle|package purchase|mobile card/i.test(t)) return "airtime";
    if (/salary|payroll/i.test(t)) return "salary";
    if (/merchant|purchased|goods|\bpos\b|bill payment|paid for/i.test(t)) return "purchase";
    return dir === "in" ? "received" : "transfer";
  }

  function holderName(t) {
    const m = t.match(/\bDear\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3})/);
    if (!m || /^(customer|client|valued|sir|madam|user|member)\b/i.test(m[1])) return "";
    return m[1].replace(/\s+(you|your|thank|thanks)\b.*$/i, "").trim();
  }

  const norm = s => (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  function sameName(a, b) {
    const A = norm(a).split(" ").filter(Boolean), B = norm(b).split(" ").filter(Boolean);
    if (A.length < 2 || B.length < 2) return false;
    const hits = A.filter(w => B.includes(w)).length;
    return hits >= 2;
  }
  const looksLikePerson = p => !!p && !BUSINESS.test(p) && /^[A-Za-z][A-Za-z.'\-]+(?:\s+[A-Za-z][A-Za-z.'\-]+){1,3}$/.test(p) && !/\d/.test(p);
  const partyKey = p => norm(p);

  function categorize(tx, rules, holder) {
    const k = partyKey(tx.party);
    if (k && rules && rules[k]) return rules[k];
    if (holder && tx.party && sameName(holder, tx.party)) return "own";
    if (/own account|between (?:my|your) accounts|to your (?:telebirr|wallet|account)/i.test(tx.raw || "")) return "own";
    const hay = (tx.party + " " + tx.purpose).trim();
    if (tx.dir === "in") {
      if (/salary|payroll|\bwage/i.test(hay) || tx.kind === "salary") return "salary";
      if (looksLikePerson(tx.party)) return "received";
      return "income_other";
    }
    if (tx.kind === "cash") return "cash";
    if (tx.kind === "airtime") return "airtime";
    for (const c of CATS) if (c.kw && !c.income && c.id !== "cash" && c.kw.test(hay)) return c.id;
    if (looksLikePerson(tx.party)) return "people";
    return "other";
  }

  /* Split a pasted blob into single messages. */
  function split(text) {
    const out = [];
    const chunks = String(text || "").replace(/\r/g, "").split(/\n\s*\n/);
    for (const c of chunks) {
      let parts = c.split(/\n(?=\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2})/);
      parts = parts.flatMap(p => (p.match(/\bDear\b/g) || []).length > 1 ? p.split(/(?=\bDear\b)/) : [p]);
      parts.forEach(p => { const s = p.trim(); if (s) out.push(s); });
    }
    return out;
  }

  function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

  /* Parse one message. Returns a transaction or {skip: reason}. */
  function parseOne(msg, opts) {
    opts = opts || {};
    let text = msg, date = null, time = "", sender = "";
    const head = text.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?(?::\d{2})?\s*(?:[|·\-–]\s*)?(?:([^|\n]{1,30}?)\s*\|\s*)?/);
    if (head) {
      date = validDate(+head[1].slice(0, 4), +head[1].slice(5, 7), +head[1].slice(8, 10), opts.today);
      time = head[2] || "";
      sender = head[3] || "";
      text = text.slice(head[0].length).trim();
    }
    const flat = text.replace(/\s+/g, " ").trim();
    if (/\b(otp|one[- ]time (?:password|pin)|verification code|activation code)\b/i.test(flat)) return { skip: "Security code, not a transaction" };

    const amounts = [];
    let m; AMT.lastIndex = 0;
    while ((m = AMT.exec(flat))) amounts.push({ v: num(m[1] || m[2]), i: m.index });
    if (!amounts.length) return { skip: "No amount found" };

    const iIn = flat.search(IN), iOut = flat.search(OUT);
    let dir = null;
    if (iIn >= 0 && (iOut < 0 || iIn < iOut)) dir = "in"; else if (iOut >= 0) dir = "out";
    if (!dir) return { skip: "Could not tell if money came in or went out" };

    const principal = amounts.find(a => !NOT_PRINCIPAL.test(flat.slice(Math.max(0, a.i - 40), a.i))) || amounts[0];
    const amount = principal.v;
    if (!(amount > 0)) return { skip: "No amount found" };

    let fee = 0;
    const tot = flat.match(/total(?: amount)?(?: debited)?(?: of| is|:)?\s*(?:ETB|Birr)?\s*([\d,]+\.\d{1,2})/i);
    if (tot && num(tot[1]) >= amount && num(tot[1]) - amount < amount * 0.25 + 100) fee = round2(num(tot[1]) - amount);
    else {
      const FEE = /(service (?:charge|fee)|transaction (?:charge|fee)|commission|levy|vat\b[^0-9]{0,3}(?:\(\d+%\))?|disaster recovery[^0-9]{0,3}(?:\(\d+%\))?)[^0-9]{0,40}?([\d,]+\.\d{1,2})/gi;
      let f; while ((f = FEE.exec(flat))) fee += num(f[2]);
      fee = round2(fee);
    }
    if (dir === "in" && fee > amount) fee = 0;

    const bal = flat.match(/balance[^0-9]{0,30}?([\d,]+\.\d{1,2})/i);
    const ref = (flat.match(/(?:ref(?:erence)?\.?\s*(?:no\.?|number|#)?|transaction (?:number|id|no\.?)(?: is)?|txn ?id|trx ?id|receipt (?:no\.?|number))\s*[:\-]?\s*([A-Z0-9]{6,})/i) || [])[1]
      || (flat.match(/https?:\/\/[^\s]*(?:reciept|receipt)[^\s\/]*\/([^\s?#]{6,})/i) || [])[1] || "";

    if (!date) date = findDate(flat, opts.today);
    if (!time) time = (flat.match(/\b(\d{1,2}:\d{2})(?::\d{2})?\b/) || [])[1] || "";
    const dateGuessed = !date;
    if (!date) date = opts.fallbackDate || opts.today || new Date().toISOString().slice(0, 10);

    const bank = opts.bank && opts.bank !== "auto" ? opts.bank : detectBank(flat, sender);
    const kind = findKind(flat, dir);
    let party = findParty(flat, dir);
    if (!party && kind === "cash") party = "ATM";
    if (!party && kind === "airtime") party = "Airtime";
    const purpose = findPurpose(flat);
    const holder = holderName(flat);

    const tx = {
      bank, dir, amount, fee, balance: bal ? num(bal[1]) : null, party, purpose, kind,
      date, time, dateGuessed, ref, raw: flat.slice(0, 600), holder
    };
    tx.key = ref ? (bank + ":" + ref).toLowerCase() : hash([bank, dir, amount, tx.balance, date, party].join("|"));
    tx.cat = categorize(tx, opts.rules, opts.holder || holder);
    return tx;
  }

  function parseMany(text, opts) {
    opts = Object.assign({}, opts);
    const parts = split(text);
    if (!opts.holder) {
      const names = parts.map(s => holderName(s.replace(/\s+/g, " "))).sort((a, b) => b.split(" ").length - a.split(" ").length);
      if (names[0] && names[0].split(" ").length >= 2) opts.holder = names[0];
    }
    const out = parts.map(s => {
      const r = parseOne(s, opts);
      return r.skip ? { skip: r.skip, raw: s.slice(0, 300) } : r;
    });
    out.holder = opts.holder || "";
    return out;
  }

  root.BirrParser = { holderName, CATS, BANK_NAMES, parseOne, parseMany, split, categorize, partyKey, detectBank };
})(typeof window !== "undefined" ? window : globalThis);
