/** Conservative OCR suggestions. Empty fields require manual entry and review. */
export function extractStaffIdSuggestions(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const valueAfter = (pattern: RegExp) => {
    const index = lines.findIndex((line) => pattern.test(line));
    if (index < 0) return "";
    const inline = lines[index].replace(pattern, "").replace(/^[\s:.-]+/, "").trim();
    return (inline || lines[index + 1] || "").slice(0, 120);
  };
  const surname = valueAfter(/^(?:APELYIDO|LAST\s*NAME|SURNAME)(?:\s*\/\s*(?:LAST\s*NAME|SURNAME))?\s*[:.-]?/i);
  const given = valueAfter(/^(?:MGA\s+PANGALAN|GIVEN\s*NAMES?|FIRST\s*NAME)(?:\s*\/\s*(?:GIVEN\s*NAMES?|FIRST\s*NAME))?\s*[:.-]?/i);
  const middle = valueAfter(/^(?:GITNANG\s+APELYIDO|MIDDLE\s*NAME)(?:\s*\/\s*MIDDLE\s*NAME)?\s*[:.-]?/i);
  const name = valueAfter(/^(?:FULL\s*NAME|NAME\s*ON\s*ID|PANGALAN)\s*[:.-]?/i) || (surname && given ? [given, middle, surname].filter(Boolean).join(" ") : "");
  const number = valueAfter(/^(?:ID\s*(?:NUMBER|NO\.?)|PSN|LICEN[CS]E\s*(?:NUMBER|NO\.?))\s*[:.-]?/i) || text.match(/\b\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{4}\b/)?.[0] || "";
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const toIsoDate = (date: string) => {
    const iso = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(date);
    const us = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(date);
    const month = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})$/i.exec(date);
    return iso
      ? `${iso[1]}-${iso[2]}-${iso[3]}`
      : us
        ? `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`
        : month
          ? `${month[3]}-${String(months.indexOf(month[1].toLowerCase()) + 1).padStart(2, "0")}-${month[2].padStart(2, "0")}`
          : "";
  };
  const birthDateText = valueAfter(/^(?:PETSA\s+NG\s+KAPANGANAKAN|DATE\s*OF\s*BIRTH|BIRTH\s*DATE|DOB)(?:\s*\/\s*(?:DATE\s*OF\s*BIRTH|BIRTH\s*DATE))?\s*[:.-]?/i);
  const expirationDateText = valueAfter(/^(?:EXPIRATION\s*DATE|EXPIRY\s*DATE|DATE\s+OF\s+EXPIRATION|DATE\s+OF\s+EXPIRY|VALID\s+(?:UNTIL|THRU|THROUGH)|EXP\.?\s*DATE)\s*[:.-]?/i);
  return {
    name,
    number,
    birth_date: toIsoDate(birthDateText),
    expiration_date: toIsoDate(expirationDateText),
  };
}
