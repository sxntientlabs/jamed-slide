export type SensitiveIdentifierKind = "name" | "medical-record" | "national-id" | "contact" | "address" | "birth-date";

export type SensitiveIdentifierFinding = {
  kind: SensitiveIdentifierKind;
  label: string;
};

type IdentifierRule = {
  kind: SensitiveIdentifierKind;
  label: string;
  pattern: RegExp;
  redact: (match: string, prefix?: string) => string;
};

const IDENTIFIER_RULES: readonly IdentifierRule[] = [
  {
    kind: "medical-record",
    label: "nomor rekam medis",
    pattern: /\b((?:no\.?\s*)?(?:rm|rekam\s*medis|mrn|medical\s*record)(?:\s*(?:number|nomor|no\.?))?\s*[:#-]?\s*)[a-z0-9][a-z0-9./-]{3,}\b/gi,
    redact: (_match, prefix = "No. RM: ") => `${prefix}[DIHAPUS]`,
  },
  {
    kind: "national-id",
    label: "NIK / identitas nasional",
    pattern: /\b((?:nik|no\.?\s*ktp)\s*[:#-]?\s*)\d{16}\b/gi,
    redact: (_match, prefix = "NIK: ") => `${prefix}[DIHAPUS]`,
  },
  {
    kind: "contact",
    label: "email",
    pattern: /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi,
    redact: () => "[EMAIL DIHAPUS]",
  },
  {
    kind: "contact",
    label: "nomor telepon",
    pattern: /\b(?:\+?62|0)8\d{7,11}\b/g,
    redact: () => "[TELEPON DIHAPUS]",
  },
  {
    kind: "name",
    label: "nama langsung",
    pattern: /\b((?:nama(?:\s+pasien)?|patient\s+name)\s*[:=-]\s*)([^\n,;]{3,70})/gi,
    redact: (_match, prefix = "Nama: ") => `${prefix}[GUNAKAN ALIAS]`,
  },
  {
    kind: "address",
    label: "alamat lengkap",
    pattern: /\b((?:alamat(?:\s+pasien)?|address)\s*[:=-]\s*)([^\n;]{6,120})/gi,
    redact: (_match, prefix = "Alamat: ") => `${prefix}[DIHAPUS]`,
  },
  {
    kind: "birth-date",
    label: "tanggal lahir",
    pattern: /\b((?:tanggal\s+lahir|tgl\.?\s*lahir|date\s+of\s+birth|dob)\s*[:=-]\s*)([^\n,;]{4,40})/gi,
    redact: (_match, prefix = "Tanggal lahir: ") => `${prefix}[DIHAPUS — gunakan usia]`,
  },
];

function freshPattern(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags);
}

export function detectSensitiveIdentifiers(text: string): SensitiveIdentifierFinding[] {
  const findings = new Map<SensitiveIdentifierKind, SensitiveIdentifierFinding>();
  IDENTIFIER_RULES.forEach((rule) => {
    if (freshPattern(rule.pattern).test(text)) findings.set(rule.kind, { kind: rule.kind, label: rule.label });
  });
  return [...findings.values()];
}

export function redactSensitiveIdentifiers(text: string): string {
  return IDENTIFIER_RULES.reduce((current, rule) => current.replace(freshPattern(rule.pattern), (...args: unknown[]) => {
    const match = String(args[0] ?? "");
    const prefix = typeof args[1] === "string" && rule.pattern.source.startsWith("\\b(") ? args[1] : undefined;
    return rule.redact(match, prefix);
  }), text);
}
