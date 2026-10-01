import type {
  ClinicalEvent,
  ClinicalField,
  InvestigationItem,
  PatientRecord,
  SourceReference,
  TreatmentItem,
} from "../types";

interface Candidate<T> {
  value: T;
  snippet: string;
}

const missing = <T>(): ClinicalField<T> => ({
  status: "missing",
  confidence: 0,
  sources: [],
});

function sourceReference(sourceId: string, snippet: string): SourceReference {
  return { sourceId, textSnippet: snippet.trim().slice(0, 220) };
}

function uniqueValues<T>(candidates: Candidate<T>[]): T[] {
  const keys = new Set<string>();
  const values: T[] = [];
  candidates.forEach((candidate) => {
    const key = JSON.stringify(candidate.value).toLowerCase();
    if (!keys.has(key)) {
      keys.add(key);
      values.push(candidate.value);
    }
  });
  return values;
}

function fieldFromCandidates<T>(candidates: Candidate<T>[], sourceId: string): ClinicalField<T> {
  const values = uniqueValues(candidates);
  if (!values.length) return missing<T>();
  const sources = candidates.map((candidate) => sourceReference(sourceId, candidate.snippet));
  if (values.length > 1) {
    return {
      value: values[0],
      alternatives: values.slice(1),
      status: "conflicting",
      confidence: 0.55,
      sources,
    };
  }
  return {
    value: values[0],
    status: "documented",
    confidence: 0.94,
    sources,
  };
}

function matchingCandidates<T>(
  source: string,
  patterns: RegExp[],
  transform: (value: string, line: string) => T = (value) => value.trim() as T,
): Candidate<T>[] {
  const candidates: Candidate<T>[] = [];
  source.split(/\r?\n/).forEach((line) => {
    const clean = line.trim();
    if (!clean) return;
    patterns.forEach((pattern) => {
      const match = clean.match(pattern);
      if (match?.[1]?.trim()) {
        candidates.push({ value: transform(match[1], clean), snippet: clean });
      }
    });
  });
  return candidates;
}

function numberValue(value: string): number {
  return Number(value.replace(/,/g, ".").replace(/[^0-9.\-]/g, ""));
}

function unitNumberCandidates(
  source: string,
  patterns: RegExp[],
  unitPattern: RegExp,
  unitScale = 1,
): Candidate<number>[] {
  const candidates: Candidate<number>[] = [];
  source.split(/\r?\n/).forEach((line) => {
    const clean = line.trim();
    patterns.forEach((pattern) => {
      const labeled = clean.match(pattern);
      if (!labeled?.[1]) return;
      const numeric = clean.match(unitPattern)?.[1] ?? labeled[1];
      const value = numberValue(numeric) * unitScale;
      if (Number.isFinite(value)) candidates.push({ value, snippet: clean });
    });
  });
  return candidates;
}

function fieldText(source: string, patterns: RegExp[], sourceId: string): ClinicalField<string> {
  return fieldFromCandidates(matchingCandidates(source, patterns), sourceId);
}

function investigationCandidates(source: string, patterns: RegExp[]): Candidate<InvestigationItem[]>[] {
  return matchingCandidates(source, patterns, (value) => {
    const items = value
      .split(/[;,|]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => ({ name: item }));
    return items.length ? items : [{ name: value.trim() }];
  });
}

function treatmentCandidates(source: string, patterns: RegExp[]): Candidate<TreatmentItem[]>[] {
  return matchingCandidates(source, patterns, (value) =>
    value
      .split(/[;,|]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => ({ name: item })),
  );
}

function splitPatientSections(rawText: string): string[] {
  const normalized = rawText.replace(/\r/g, "").trim();
  if (!normalized) return [];
  const lines = normalized.split("\n");
  const starts = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) =>
      /^\s*(?:pasien\s*(?:ke[- ]?)?\d+|pasien\s*[:\-]|patient\s*\d+|\d+[.)]\s*(?:an\.?|ny\.?|tn\.?|by\.?|sdr\.?))/i.test(
        line,
      ),
    )
    .map(({ index }) => index);
  if (starts.length <= 1) return [normalized];
  return starts.map((start, index) => lines.slice(start, starts[index + 1] ?? lines.length).join("\n").trim());
}

function patientHeading(section: string, index: number): string {
  const firstLine = section.split("\n").find((line) => line.trim())?.trim() ?? "";
  const heading = firstLine
    .replace(/^pasien\s*(?:ke[- ]?)?\d*\s*[:.)-]?/i, "")
    .replace(/^patient\s*\d*\s*[:.)-]?/i, "")
    .trim();
  return heading || `Pasien ${index + 1}`;
}

function eventCategory(description: string): ClinicalEvent["category"] {
  const value = description.toLowerCase();
  if (/(datang|masuk|presentasi)/.test(value)) return "presentation";
  if (/(lab|radiologi|usg|pemeriksaan)/.test(value)) return "investigation";
  if (/(obat|terapi|oksigen|nebul|tindakan|cairan)/.test(value)) return "treatment";
  if (/(konsul|konsultasi)/.test(value)) return "consultation";
  if (/(membaik|memburuk|respon|saturasi)/.test(value)) return "response";
  if (/(pulang|rawat|rujuk|disposisi)/.test(value)) return "disposition";
  return "assessment";
}

function extractTimeline(section: string, sourceId: string): ClinicalEvent[] {
  const events: Array<ClinicalEvent | undefined> = section
    .split(/\r?\n/)
    .map((line, index) => {
      const match = line.trim().match(/^(\d{1,2}[:.]\d{2})\s*[-–:]\s*(.+)$/);
      if (!match) return undefined;
      return {
        id: `${sourceId}-event-${index}`,
        timestamp: match[1].replace(".", ":"),
        category: eventCategory(match[2]),
        description: match[2].trim(),
        sources: [sourceReference(sourceId, line)],
      } satisfies ClinicalEvent;
    });
  return events.filter((event): event is ClinicalEvent => Boolean(event));
}

function buildPatient(section: string, index: number, sourceId: string): PatientRecord {
  const name = fieldText(section, [/^\s*(?:nama|name)\s*[:\-]\s*(.+)$/i], sourceId);
  const initials = fieldText(section, [/^\s*inisial\s*[:\-]\s*(.+)$/i], sourceId);
  const medicalRecordNumber = fieldText(
    section,
    [/^\s*(?:no\.?\s*rm|rm|medical record)\s*[:\-]\s*(.+)$/i],
    sourceId,
  );
  const age = fieldText(section, [/^\s*(?:usia|umur|age)\s*[:\-]\s*(.+)$/i], sourceId);
  const sex = fieldText(section, [/^\s*(?:jenis kelamin|gender|sex)\s*[:\-]\s*(.+)$/i], sourceId);
  const weightKg = fieldFromCandidates(
    unitNumberCandidates(
      section,
      [/^\s*(?:bb|berat badan|weight)\s*[:\-]?\s*(.+)$/i],
      /([\d,.]+)\s*(?:kg|kilogram)/i,
    ),
    sourceId,
  );
  const heightCm = fieldFromCandidates(
    unitNumberCandidates(
      section,
      [/^\s*(?:tb|tinggi badan|height)\s*[:\-]?\s*(.+)$/i],
      /([\d,.]+)\s*(?:cm|sentimeter)/i,
    ),
    sourceId,
  );

  const patient: PatientRecord = {
    id: `${sourceId}-patient-${index + 1}`,
    displayName: name.value || initials.value || patientHeading(section, index),
    identifiers: { name, initials, medicalRecordNumber },
    demographics: { age, sex, weightKg, heightCm },
    admission: {
      arrivalTime: fieldText(section, [/^\s*(?:jam datang|waktu masuk|arrival time)\s*[:\-]\s*(.+)$/i], sourceId),
      admissionDate: fieldText(section, [/^\s*(?:tanggal masuk|admission date)\s*[:\-]\s*(.+)$/i], sourceId),
      referralSource: fieldText(section, [/^\s*(?:rujukan|asal rujukan|referral)\s*[:\-]\s*(.+)$/i], sourceId),
    },
    chiefComplaint: fieldText(
      section,
      [/^\s*(?:keluhan utama|chief complaint|ku)\s*[:\-]\s*(.+)$/i],
      sourceId,
    ),
    urgency: fieldText(
      section,
      [/^\s*(?:kegawatan|emergency|urgent)\s*[:\-]\s*(t|f|true|false)\b.*$/i],
      sourceId,
    ),
    history: {
      presentIllness: fieldText(
        section,
        [/^\s*(?:rps|riwayat penyakit sekarang|present illness)\s*[:\-]\s*(.+)$/i],
        sourceId,
      ),
      pastMedicalHistory: fieldText(
        section,
        [/^\s*(?:rpd|riwayat penyakit dahulu|past medical history)\s*[:\-]\s*(.+)$/i],
        sourceId,
      ),
      medicationHistory: fieldText(
        section,
        [/^\s*(?:riwayat obat|obat sebelumnya|medication history)\s*[:\-]\s*(.+)$/i],
        sourceId,
      ),
      allergyHistory: fieldText(section, [/^\s*(?:alergi|allergy)\s*[:\-]\s*(.+)$/i], sourceId),
      birthHistory: fieldText(
        section,
        [/^\s*(?:riwayat lahir|riwayat persalinan|birth history)\s*[:\-]\s*(.+)$/i],
        sourceId,
      ),
      immunizationHistory: fieldText(
        section,
        [/^\s*(?:imunisasi|immunization)\s*[:\-]\s*(.+)$/i],
        sourceId,
      ),
      familyHistory: fieldText(
        section,
        [/^\s*(?:riwayat keluarga|family history)\s*[:\-]\s*(.+)$/i],
        sourceId,
      ),
      nutritionHistory: fieldText(
        section,
        [/^\s*(?:riwayat nutrisi|nutrisi|nutrition history)\s*[:\-]\s*(.+)$/i],
        sourceId,
      ),
      socioeconomicHistory: fieldText(
        section,
        [/^\s*(?:riwayat sosioekonomi|sosioekonomi|socioeconomic history)\s*[:\-]\s*(.+)$/i],
        sourceId,
      ),
    },
    physicalExam: {
      generalAppearance: fieldText(
        section,
        [/^\s*(?:keadaan umum|general appearance)\s*[:\-]\s*(.+)$/i],
        sourceId,
      ),
      consciousness: fieldText(section, [/^\s*(?:kesadaran|gcs|consciousness)\s*[:\-]\s*(.+)$/i], sourceId),
      vitalSigns: {
        bloodPressure: fieldText(section, [/^\s*(?:td|tekanan darah|blood pressure)\s*[:\-]\s*(.+)$/i], sourceId),
        heartRate: fieldFromCandidates(
          matchingCandidates(section, [/^\s*(?:nadi|hr|denyut jantung|heart rate)\s*[:\-]\s*(.+)$/i], numberValue),
          sourceId,
        ),
        respiratoryRate: fieldFromCandidates(
          matchingCandidates(section, [/^\s*(?:rr|laju napas|frekuensi napas|respiratory rate)\s*[:\-]\s*(.+)$/i], numberValue),
          sourceId,
        ),
        temperature: fieldFromCandidates(
          matchingCandidates(section, [/^\s*(?:suhu|temperature)\s*[:\-]\s*(.+)$/i], numberValue),
          sourceId,
        ),
        spo2: fieldFromCandidates(
          matchingCandidates(section, [/^\s*(?:spo2|saturasi|saturasi oksigen)\s*[:\-]?\s*(.+)$/i], numberValue),
          sourceId,
        ),
      },
      findings: fieldText(
        section,
        [/^\s*(?:temuan pemeriksaan|pemeriksaan fisis|pemeriksaan fisik|findings|kesan)\s*[:\-]\s*(.+)$/i],
        sourceId,
      ),
    },
    investigations: {
      laboratory: fieldFromCandidates(
        investigationCandidates(section, [/^\s*(?:laboratorium|lab|hasil lab)\s*[:\-]\s*(.+)$/i]),
        sourceId,
      ),
      imaging: fieldFromCandidates(
        investigationCandidates(section, [/^\s*(?:radiologi|usg|imaging)\s*[:\-]\s*(.+)$/i]),
        sourceId,
      ),
      other: missing<InvestigationItem[]>(),
    },
    assessment: {
      workingDiagnosis: fieldFromCandidates(
        matchingCandidates(section, [/^\s*(?:diagnosis|diagnosa|assessment)\s*[:\-]\s*(.+)$/i], (value) =>
          value
            .split(/[,;|]/)
            .map((item) => item.trim())
            .filter(Boolean),
        ),
        sourceId,
      ),
      differentialDiagnosis: fieldFromCandidates(
        matchingCandidates(section, [/^\s*(?:diagnosis banding|dd|differential)\s*[:\-]\s*(.+)$/i], (value) =>
          value
            .split(/[,;|]/)
            .map((item) => item.trim())
            .filter(Boolean),
        ),
        sourceId,
      ),
    },
    management: {
      medications: fieldFromCandidates(
        treatmentCandidates(section, [/^\s*(?:obat|medikamentosa|medications)\s*[:\-]\s*(.+)$/i]),
        sourceId,
      ),
      fluids: fieldFromCandidates(
        treatmentCandidates(section, [/^\s*(?:cairan|fluids)\s*[:\-]\s*(.+)$/i]),
        sourceId,
      ),
      procedures: fieldFromCandidates(
        treatmentCandidates(section, [/^\s*(?:tindakan|prosedur|procedures)\s*[:\-]\s*(.+)$/i]),
        sourceId,
      ),
      oxygenTherapy: fieldFromCandidates(
        treatmentCandidates(section, [/^\s*(?:oksigen|terapi oksigen|oxygen therapy)\s*[:\-]\s*(.+)$/i]),
        sourceId,
      ),
    },
    disposition: fieldText(section, [/^\s*(?:disposisi|disposition)\s*[:\-]\s*(.+)$/i], sourceId),
    timeline: extractTimeline(section, sourceId),
    sourceId,
  };

  return patient;
}

export interface ExtractionResult {
  sourceId: string;
  patients: PatientRecord[];
  sourceText: string;
}

export function extractPatients(rawText: string, sourceId = `source-${Date.now()}`): ExtractionResult {
  const sections = splitPatientSections(rawText);
  return {
    sourceId,
    sourceText: rawText,
    patients: sections.map((section, index) => buildPatient(section, index, sourceId)),
  };
}

export function formatFieldValue(field?: ClinicalField<unknown>): string {
  if (!field || field.status === "missing" || field.value === undefined || field.value === null) {
    return "Tidak tercantum";
  }
  if (Array.isArray(field.value)) {
    return field.value
      .map((item) => {
        if (typeof item === "string" || typeof item === "number") return String(item);
        if ("name" in (item as object)) return (item as { name: string }).name;
        return JSON.stringify(item);
      })
      .join("\n");
  }
  return String(field.value);
}
