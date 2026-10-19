import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadString } from "firebase/storage";
import { firebaseStorage, firestore, getFirebaseSetupError } from "./firebase";
import { stripUndefinedFirestoreValues } from "./firestoreData";
import type { OpsAssessmentAttempt, OpsEncounter } from "./clinicalOps";
import type { EvidenceSource } from "./evidenceSearchClient";

export type RemoteAttachmentKind = "image" | "pdf" | "audio";

export type RemoteChatAttachment = {
  name: string;
  mimeType: string;
  kind: RemoteAttachmentKind;
  storagePath?: string;
};

export type RemoteChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  agentId?: string;
  fallback?: boolean;
  error?: boolean;
  retryPrompt?: string;
  action?: "lapjag";
  requestId?: string;
  durationMs?: number;
  sourceMode?: "workspace" | "attachments" | "sources";
  citationSources?: EvidenceSource[];
  followUpQuestions?: string[];
  reviewRequired?: boolean;
  attachments?: RemoteChatAttachment[];
};

export type RemoteChatSession = {
  id: string;
  title: string;
  modeId: string;
  updatedAt: number;
  messages: RemoteChatMessage[];
};

export type RemoteWorkspace = {
  rotation: string;
  unit: string;
  shift: string;
  goal: string;
  notes?: string;
  contextFile?: {
    name: string;
    mimeType: string;
    sizeBytes: number;
    kind: "pdf" | "docx" | "pptx" | "text" | "other";
    storagePath?: string;
  };
};

export type RemoteWorkspaceTask = {
  id: string;
  label: string;
  detail: string;
  done: boolean;
};

export type RemoteKoasisState = {
  schemaVersion: 1;
  workspace: RemoteWorkspace;
  tasks: RemoteWorkspaceTask[];
  preferences: {
    themeMode: "light" | "dark";
    modelId: string;
    reasoningEffort: string;
    workspacePanelOpen?: boolean;
    shiftPhase?: "before" | "during" | "after";
  };
};

export type RemoteClinicalState = {
  schemaVersion: 1;
  encounters: OpsEncounter[];
  attempts: OpsAssessmentAttempt[];
};

export type RemoteMkarEvidence = {
  id: string;
  targetId?: string;
  assessmentId?: string;
  context: string;
  note: string;
  createdAt: string;
};

export type UploadableAttachment = {
  name: string;
  mimeType: string;
  kind: RemoteAttachmentKind;
  dataUrl?: string;
};

export type UploadableFile = {
  name: string;
  mimeType: string;
  dataUrl?: string;
};

export type RemoteStoredFile = {
  name: string;
  mimeType: string;
  storagePath: string;
};

const MAX_SESSIONS = 30;
const MAX_MESSAGES_PER_SESSION = 40;

function requireFirestore() {
  if (!firestore) throw new Error(getFirebaseSetupError() || "Firestore belum tersedia.");
  return firestore;
}

function requireStorage() {
  if (!firebaseStorage) throw new Error(getFirebaseSetupError() || "Firebase Storage belum tersedia.");
  return firebaseStorage;
}

function userKoasisDocument(userId: string, documentName: string) {
  return doc(requireFirestore(), "users", userId, "koasis", documentName);
}

function userSessionsCollection(userId: string) {
  return collection(requireFirestore(), "users", userId, "koasis", "sessions", "items");
}

function userKoasisCollectionDocument(userId: string, documentName: string) {
  return doc(requireFirestore(), "users", userId, "koasis", documentName);
}

function timestampToMillis(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "toMillis" in value && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return Number((value as { toMillis: () => number }).toMillis());
  }
  return 0;
}

function normalizeRemoteAttachment(value: unknown): RemoteChatAttachment | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<RemoteChatAttachment>;
  if (typeof item.name !== "string" || typeof item.mimeType !== "string") return null;
  if (item.kind !== "image" && item.kind !== "pdf" && item.kind !== "audio") return null;
  return {
    name: item.name.slice(0, 180),
    mimeType: item.mimeType.slice(0, 120),
    kind: item.kind,
    storagePath: typeof item.storagePath === "string" ? item.storagePath.slice(0, 500) : undefined,
  };
}

function normalizeRemoteEvidenceSource(value: unknown): EvidenceSource | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<EvidenceSource>;
  const validProviders = ["pubmed", "europepmc", "openalex", "crossref", "web"] as const;
  if (!validProviders.includes(item.source as (typeof validProviders)[number])) return null;
  if (typeof item.id !== "string" || typeof item.title !== "string" || typeof item.url !== "string") return null;
  if (!/^https?:\/\//i.test(item.url)) return null;
  const figures = Array.isArray(item.figures) ? item.figures.map((value, index) => {
    if (!value || typeof value !== "object") return null;
    const figure = value as Partial<NonNullable<EvidenceSource["figures"]>[number]>;
    if (typeof figure.imageUrl !== "string" || !/^https?:\/\//i.test(figure.imageUrl) || typeof figure.caption !== "string") return null;
    return {
      id: typeof figure.id === "string" ? figure.id.slice(0, 200) : `${item.id}-figure-${index + 1}`,
      label: typeof figure.label === "string" ? figure.label.slice(0, 120) : undefined,
      caption: figure.caption.slice(0, 900),
      imageUrl: figure.imageUrl.slice(0, 1_000),
      sourceUrl: typeof figure.sourceUrl === "string" && /^https?:\/\//i.test(figure.sourceUrl) ? figure.sourceUrl.slice(0, 1_000) : undefined,
    };
  }).filter((figure): figure is NonNullable<typeof figure> => Boolean(figure)).slice(0, 3) : undefined;
  return {
    id: item.id.slice(0, 300),
    source: item.source as EvidenceSource["source"],
    sourceIds: Array.isArray(item.sourceIds) ? item.sourceIds.filter((source): source is EvidenceSource["source"] => validProviders.includes(source as (typeof validProviders)[number])).slice(0, 4) : undefined,
    title: item.title.slice(0, 500),
    authors: typeof item.authors === "string" ? item.authors.slice(0, 500) : "",
    journal: typeof item.journal === "string" ? item.journal.slice(0, 300) : "",
    year: typeof item.year === "string" ? item.year.slice(0, 20) : undefined,
    doi: typeof item.doi === "string" ? item.doi.slice(0, 300) : undefined,
    pmid: typeof item.pmid === "string" ? item.pmid.slice(0, 80) : undefined,
    pmcid: typeof item.pmcid === "string" ? item.pmcid.slice(0, 80) : undefined,
    abstract: typeof item.abstract === "string" ? item.abstract.slice(0, 1_800) : undefined,
    isOpenAccess: item.isOpenAccess === true,
    fullTextUrl: typeof item.fullTextUrl === "string" && /^https?:\/\//i.test(item.fullTextUrl) ? item.fullTextUrl.slice(0, 1_000) : undefined,
    figures: figures?.length ? figures : undefined,
    citedByCount: typeof item.citedByCount === "number" && Number.isFinite(item.citedByCount) ? item.citedByCount : undefined,
    publicationTypes: Array.isArray(item.publicationTypes) ? item.publicationTypes.filter((type): type is string => typeof type === "string").map((type) => type.slice(0, 120)).slice(0, 12) : undefined,
    retractionStatus: item.retractionStatus === "retracted" || item.retractionStatus === "corrected" || item.retractionStatus === "unknown" ? item.retractionStatus : undefined,
    score: typeof item.score === "number" && Number.isFinite(item.score) ? item.score : undefined,
    matchReasons: Array.isArray(item.matchReasons) ? item.matchReasons.filter((reason): reason is string => typeof reason === "string").map((reason) => reason.slice(0, 180)).slice(0, 8) : undefined,
    url: item.url.slice(0, 1_000),
  };
}

function normalizeRemoteMessage(value: unknown): RemoteChatMessage | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<RemoteChatMessage>;
  if ((item.role !== "user" && item.role !== "assistant") || typeof item.content !== "string") return null;
  const message: RemoteChatMessage = {
    id: typeof item.id === "string" ? item.id : `message-${Date.now()}`,
    role: item.role,
    content: item.content.slice(0, 40_000),
    timestamp: typeof item.timestamp === "string" ? item.timestamp : "",
    agentId: typeof item.agentId === "string" ? item.agentId : undefined,
    fallback: Boolean(item.fallback),
    error: Boolean(item.error),
    retryPrompt: typeof item.retryPrompt === "string" ? item.retryPrompt.slice(0, 40_000) : undefined,
    action: item.action === "lapjag" ? "lapjag" : undefined,
    requestId: typeof item.requestId === "string" ? item.requestId : undefined,
    durationMs: typeof item.durationMs === "number" ? item.durationMs : undefined,
    sourceMode: item.sourceMode === "workspace" || item.sourceMode === "attachments" || item.sourceMode === "sources" ? item.sourceMode : undefined,
    followUpQuestions: Array.isArray(item.followUpQuestions) ? item.followUpQuestions.filter((question): question is string => typeof question === "string" && question.trim().length > 0).map((question) => question.slice(0, 240)).slice(0, 3) : undefined,
    reviewRequired: typeof item.reviewRequired === "boolean" ? item.reviewRequired : undefined,
  };
  const attachments = Array.isArray(item.attachments) ? item.attachments.map(normalizeRemoteAttachment).filter((attachment): attachment is RemoteChatAttachment => Boolean(attachment)) : [];
  if (attachments.length) message.attachments = attachments;
  const citationSources = Array.isArray(item.citationSources) ? item.citationSources.map(normalizeRemoteEvidenceSource).filter((source): source is EvidenceSource => Boolean(source)).slice(0, 8) : [];
  if (citationSources.length) message.citationSources = citationSources;
  return message;
}

function normalizeRemoteSession(value: unknown): RemoteChatSession | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<RemoteChatSession>;
  if (typeof item.id !== "string" || typeof item.title !== "string" || typeof item.modeId !== "string") return null;
  const messages = Array.isArray(item.messages) ? item.messages.map(normalizeRemoteMessage).filter((message): message is RemoteChatMessage => Boolean(message)).slice(-MAX_MESSAGES_PER_SESSION) : [];
  if (!messages.length) return null;
  return {
    id: item.id,
    title: item.title.slice(0, 180),
    modeId: item.modeId,
    updatedAt: timestampToMillis(item.updatedAt),
    messages,
  };
}

export async function loadKoasisState(userId: string): Promise<RemoteKoasisState | null> {
  const snapshot = await getDoc(userKoasisDocument(userId, "state"));
  if (!snapshot.exists()) return null;
  const data = snapshot.data() as Partial<RemoteKoasisState>;
  if (data.schemaVersion !== 1 || !data.workspace || !Array.isArray(data.tasks) || !data.preferences) return null;
  return {
    schemaVersion: 1,
    workspace: data.workspace as RemoteWorkspace,
    tasks: data.tasks.filter((task): task is RemoteWorkspaceTask => Boolean(task) && typeof task === "object" && typeof task.id === "string" && typeof task.label === "string" && typeof task.detail === "string" && typeof task.done === "boolean").slice(0, 100),
    preferences: {
      themeMode: data.preferences.themeMode === "light" ? "light" : "dark",
      modelId: typeof data.preferences.modelId === "string" ? data.preferences.modelId : "cito",
      reasoningEffort: typeof data.preferences.reasoningEffort === "string" ? data.preferences.reasoningEffort : "moderate",
      workspacePanelOpen: Boolean(data.preferences.workspacePanelOpen),
      shiftPhase: data.preferences.shiftPhase === "during" || data.preferences.shiftPhase === "after" ? data.preferences.shiftPhase : "before",
    },
  };
}

export async function saveKoasisState(userId: string, state: RemoteKoasisState): Promise<void> {
  await setDoc(userKoasisDocument(userId, "state"), stripUndefinedFirestoreValues({
    ...state,
    updatedAt: serverTimestamp(),
  }), { merge: true });
}

export async function loadKoasisSessions(userId: string): Promise<RemoteChatSession[]> {
  const snapshot = await getDocs(query(userSessionsCollection(userId), orderBy("updatedAt", "desc"), limit(MAX_SESSIONS)));
  return snapshot.docs.map((item) => normalizeRemoteSession(item.data())).filter((session): session is RemoteChatSession => Boolean(session));
}

export async function saveKoasisSession(userId: string, session: RemoteChatSession): Promise<void> {
  const messages = stripUndefinedFirestoreValues(session.messages.slice(-MAX_MESSAGES_PER_SESSION).map(({ attachments, ...message }) => ({
    ...message,
    ...(attachments?.length ? {
      attachments: attachments.map(({ name, mimeType, kind, storagePath }) => ({
        name,
        mimeType,
        kind,
        ...(storagePath !== undefined ? { storagePath } : {}),
      })),
    } : {}),
  })));
  await setDoc(doc(userSessionsCollection(userId), session.id), {
    schemaVersion: 1,
    id: session.id,
    title: session.title.slice(0, 180),
    modeId: session.modeId,
    updatedAt: serverTimestamp(),
    messages,
  }, { merge: true });
}

function isOpsEncounter(value: unknown): value is OpsEncounter {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<OpsEncounter>;
  return typeof item.id === "string"
    && typeof item.alias === "string"
    && typeof item.setting === "string"
    && (item.kind === "encounter" || item.kind === "procedure" || item.kind === "monitoring" || item.kind === "feedback")
    && typeof item.summary === "string"
    && typeof item.nextStep === "string"
    && typeof item.createdAt === "string";
}

function isOpsAssessmentAttempt(value: unknown): value is OpsAssessmentAttempt {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<OpsAssessmentAttempt>;
  return typeof item.id === "string" && typeof item.assessmentId === "string" && typeof item.note === "string" && typeof item.createdAt === "string";
}

export async function loadClinicalState(userId: string): Promise<RemoteClinicalState | null> {
  const snapshot = await getDoc(userKoasisCollectionDocument(userId, "clinical"));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  if (data.schemaVersion !== 1) return null;
  return {
    schemaVersion: 1,
    encounters: Array.isArray(data.encounters) ? data.encounters.filter(isOpsEncounter).slice(0, 40) : [],
    attempts: Array.isArray(data.attempts) ? data.attempts.filter(isOpsAssessmentAttempt).slice(0, 50) : [],
  };
}

export async function saveClinicalState(userId: string, state: RemoteClinicalState): Promise<void> {
  await setDoc(userKoasisCollectionDocument(userId, "clinical"), stripUndefinedFirestoreValues({
    schemaVersion: 1,
    encounters: state.encounters.slice(0, 40),
    attempts: state.attempts.slice(0, 50),
    updatedAt: serverTimestamp(),
  }), { merge: true });
}

function isRemoteMkarEvidence(value: unknown): value is RemoteMkarEvidence {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<RemoteMkarEvidence>;
  return typeof item.id === "string"
    && (item.targetId === undefined || typeof item.targetId === "string")
    && (item.assessmentId === undefined || typeof item.assessmentId === "string")
    && typeof item.context === "string"
    && typeof item.note === "string"
    && typeof item.createdAt === "string";
}

export async function loadMkarEvidence(userId: string): Promise<RemoteMkarEvidence[]> {
  const snapshot = await getDoc(userKoasisCollectionDocument(userId, "portfolio"));
  if (!snapshot.exists()) return [];
  const data = snapshot.data();
  return Array.isArray(data.evidence) ? data.evidence.filter(isRemoteMkarEvidence).slice(0, 200) : [];
}

export async function saveMkarEvidence(userId: string, evidence: RemoteMkarEvidence[]): Promise<void> {
  await setDoc(userKoasisCollectionDocument(userId, "portfolio"), {
    schemaVersion: 1,
    evidence: evidence.slice(0, 200).map(({ targetId, assessmentId, ...item }) => ({
      ...item,
      ...(targetId !== undefined ? { targetId } : {}),
      ...(assessmentId !== undefined ? { assessmentId } : {}),
    })),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function uploadKoasisFile(userId: string, file: UploadableFile, folder = "attachments"): Promise<RemoteStoredFile | null> {
  if (!file.dataUrl) return null;
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120) || "file";
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const safeFolder = folder.replace(/[^a-zA-Z0-9/_-]+/g, "-").replace(/^\/+|\/+$/g, "") || "attachments";
  const storagePath = `users/${userId}/${safeFolder}/${id}-${safeName}`;
  await uploadString(ref(requireStorage(), storagePath), file.dataUrl, "data_url", {
    contentType: file.mimeType,
    customMetadata: { originalName: file.name, source: "koasis" },
  });
  return { name: file.name, mimeType: file.mimeType, storagePath };
}

export async function uploadKoasisAttachment(userId: string, attachment: UploadableAttachment): Promise<RemoteChatAttachment | null> {
  const stored = await uploadKoasisFile(userId, attachment, "attachments");
  return stored ? { ...stored, kind: attachment.kind } : null;
}

export async function downloadKoasisFileDataUrl(storagePath: string): Promise<string> {
  const response = await fetch(await getDownloadURL(ref(requireStorage(), storagePath)));
  if (!response.ok) throw new Error(`File konteks gagal diambil (HTTP ${response.status}).`);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("File konteks gagal dibaca."));
    reader.onerror = () => reject(reader.error ?? new Error("File konteks gagal dibaca."));
    reader.readAsDataURL(blob);
  });
}
