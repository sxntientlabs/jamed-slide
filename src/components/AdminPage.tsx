import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, CircleAlert, Database, KeyRound, LogOut, Plus, RefreshCw, Save, Settings2, ShieldCheck, Trash2, Users, X } from "lucide-react";
import { loadAdminConfig, loadAdminSession, loginAdmin, logoutAdmin, saveAdminConfig, type AdminSession } from "../lib/adminApi";
import { createDefaultAdminConfig, sanitizeAdminConfig, type AdminAgentConfig, type AdminConfig, type AdminKnowledgeBaseItem, type AdminModelConfig } from "../lib/adminConfig";

type AdminTab = "models" | "agents";

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || `custom-agent-${Date.now()}`;
}

function defaultCustomAgent(id: string): AdminAgentConfig {
  return {
    id,
    label: "Specialist Agent baru",
    shortDescription: "Agent khusus yang bisa kamu konfigurasi.",
    purpose: "Membantu pekerjaan yang memiliki fokus khusus.",
    group: "core",
    riskTier: "workflow",
    riskLabel: "Workflow support",
    sourcePolicy: "workspace",
    sourceLabel: "Konteks workspace",
    outputContract: ["Tujuan", "Temuan", "Next action"],
    handoffDescription: "Gunakan saat pekerjaan membutuhkan fokus khusus.",
    glyph: "agent",
    enabled: true,
    systemPrompt: "Bantu pengguna mencapai tujuan dengan output yang jelas, terukur, dan mudah direview. Jangan mengarang fakta klinis atau sumber.",
    knowledgeBase: [],
    personalization: {
      tone: "Tenang, jelas, dan kolaboratif.",
      responseStyle: "Gunakan struktur yang mudah dipindai dan nyatakan ketidakpastian.",
      targetAudience: "Mahasiswa kedokteran dan tim klinis dalam batas supervisi.",
      domainFocus: "",
      additionalInstructions: "",
    },
  };
}

function defaultCustomModel(id: string): AdminModelConfig {
  return { id, label: "Model baru", tier: "Custom", description: "Model provider yang dikonfigurasi admin.", providerModelId: "", enabled: true };
}

function TextField({ label, value, onChange, placeholder, multiline = false }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; multiline?: boolean }) {
  return <label className="koasis-admin-field"><span>{label}</span>{multiline ? <textarea value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /> : <input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />}</label>;
}

function AdminLogin({ onAuthenticated }: { onAuthenticated: (session: AdminSession) => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [session, setSession] = useState<AdminSession | null>(null);

  useEffect(() => {
    let disposed = false;
    void loadAdminSession().then((next) => {
      if (!disposed) setSession(next);
    }).catch(() => undefined);
    return () => { disposed = true; };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const next = await loginAdmin(password);
      onAuthenticated(next);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login admin gagal.");
    } finally {
      setBusy(false);
    }
  };

  return <main className="koasis-admin-shell koasis-admin-login-shell">
    <section className="koasis-admin-login-card">
      <div className="koasis-admin-brand"><span className="koasis-admin-brand-mark">K</span><span><strong>Koasis Admin</strong><small>Backend &amp; specialist control plane</small></span></div>
      <div className="koasis-admin-login-icon"><ShieldCheck size={24} /></div>
      <span className="koasis-admin-overline">Restricted workspace</span>
      <h1>Masuk ke panel admin</h1>
      <p>Atur model provider dan katalog specialist agent. Password diverifikasi di server dan tidak disimpan di browser.</p>
      <form onSubmit={submit} className="koasis-admin-login-form">
        <label className="koasis-admin-field"><span>Password admin</span><input autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Masukkan password" autoComplete="current-password" /></label>
        {error && <div className="koasis-admin-alert error" role="alert"><CircleAlert size={15} />{error}</div>}
        {session && !session.configured && <div className="koasis-admin-alert warning" role="alert"><CircleAlert size={15} />Password admin belum diatur di environment server.</div>}
        <button className="koasis-admin-primary" type="submit" disabled={busy || !password.trim()}>{busy ? <RefreshCw size={15} className="koasis-admin-spin" /> : <KeyRound size={15} />} Masuk</button>
      </form>
      <div className="koasis-admin-login-note"><Database size={14} /><span>Konfigurasi disimpan server-side. Set <code>KOASIS_ADMIN_PASSWORD</code> di environment App Hosting/Dokploy.</span></div>
    </section>
  </main>;
}

function AdminHeader({ tab, onTab, persistenceConfigured, onSave, saving, onLogout }: { tab: AdminTab; onTab: (tab: AdminTab) => void; persistenceConfigured: boolean; onSave: () => void; saving: boolean; onLogout: () => void }) {
  return <header className="koasis-admin-header">
    <div className="koasis-admin-header-brand"><span className="koasis-admin-brand-mark">K</span><div><strong>Koasis Admin</strong><small>Control plane</small></div></div>
    <nav className="koasis-admin-tabs" aria-label="Admin sections"><button type="button" className={tab === "models" ? "active" : ""} onClick={() => onTab("models")}><Settings2 size={15} />Model backend</button><button type="button" className={tab === "agents" ? "active" : ""} onClick={() => onTab("agents")}><Users size={15} />Specialist catalog</button></nav>
    <div className="koasis-admin-header-actions"><span className={`koasis-admin-db-status ${persistenceConfigured ? "ready" : "warning"}`}><i />{persistenceConfigured ? "PostgreSQL tersambung" : "PostgreSQL belum tersambung"}</span><button type="button" className="koasis-admin-secondary" onClick={onLogout}><LogOut size={14} />Keluar</button><button type="button" className="koasis-admin-primary compact" onClick={onSave} disabled={saving}>{saving ? <RefreshCw size={14} className="koasis-admin-spin" /> : <Save size={14} />}Simpan</button></div>
  </header>;
}

function ModelEditor({ config, selectedId, onSelect, onChange }: { config: AdminConfig; selectedId: string; onSelect: (id: string) => void; onChange: (next: AdminConfig) => void }) {
  const selected = config.models.find((model) => model.id === selectedId) || config.models[0];
  if (!selected) return null;
  const update = (patch: Partial<AdminModelConfig>) => onChange({ ...config, models: config.models.map((model) => model.id === selected.id ? { ...model, ...patch } : model) });
  const rename = (value: string) => {
    const id = slugify(value) || selected.id;
    if (id === selected.id) {
      update({ id });
      return;
    }
    onChange({ ...config, defaultModelId: config.defaultModelId === selected.id ? id : config.defaultModelId, models: config.models.map((model) => model.id === selected.id ? { ...model, id } : model) });
    onSelect(id);
  };
  const remove = () => {
    if (config.models.length <= 1) return;
    const nextModels = config.models.filter((model) => model.id !== selected.id);
    onChange({ ...config, models: nextModels, defaultModelId: config.defaultModelId === selected.id ? nextModels[0].id : config.defaultModelId });
    onSelect(nextModels[0].id);
  };
  return <div className="koasis-admin-section-grid">
    <aside className="koasis-admin-list-panel"><div className="koasis-admin-list-heading"><div><span className="koasis-admin-overline">Provider routes</span><strong>{config.models.length} model ID</strong></div><button type="button" className="koasis-admin-icon-button" aria-label="Tambah model" onClick={() => { const id = `model-${config.models.length + 1}`; onChange({ ...config, models: [...config.models, defaultCustomModel(id)] }); onSelect(id); }}><Plus size={16} /></button></div><div className="koasis-admin-list">{config.models.map((model) => <button type="button" key={model.id} className={selected.id === model.id ? "active" : ""} onClick={() => onSelect(model.id)}><span className={`koasis-admin-list-dot ${model.enabled ? "on" : ""}`} /><span><strong>{model.label}</strong><small>{model.providerModelId || "Provider ID belum diisi"}</small></span><ChevronRight size={14} /></button>)}</div></aside>
    <section className="koasis-admin-editor"><div className="koasis-admin-editor-heading"><div><span className="koasis-admin-overline">Model configuration</span><h2>{selected.label}</h2><p>Provider model ID ini yang dikirim ke backend AI ketika model dipilih.</p></div><label className="koasis-admin-switch"><input type="checkbox" checked={selected.enabled} onChange={(event) => update({ enabled: event.target.checked })} /><span /><b>{selected.enabled ? "Aktif" : "Nonaktif"}</b></label></div><div className="koasis-admin-form-grid"><TextField label="Model key" value={selected.id} onChange={rename} placeholder="contoh: elective" /><TextField label="Label UI" value={selected.label} onChange={(value) => update({ label: value })} /><TextField label="Tier" value={selected.tier} onChange={(value) => update({ tier: value })} /><TextField label="Provider model ID" value={selected.providerModelId} onChange={(value) => update({ providerModelId: value })} placeholder="contoh: cx/gpt-5.6-terra" /><TextField label="Deskripsi" value={selected.description} onChange={(value) => update({ description: value })} multiline /></div><label className="koasis-admin-default-check"><input type="radio" name="default-model" checked={config.defaultModelId === selected.id} onChange={() => onChange({ ...config, defaultModelId: selected.id })} />Jadikan model default untuk user baru</label><div className="koasis-admin-danger-row"><button type="button" className="koasis-admin-danger" disabled={config.models.length <= 1} onClick={remove}><Trash2 size={14} />Hapus model ini</button></div></section>
  </div>;
}

function KnowledgeBaseEditor({ items, onChange }: { items: AdminKnowledgeBaseItem[]; onChange: (items: AdminKnowledgeBaseItem[]) => void }) {
  return <section className="koasis-admin-subsection"><div className="koasis-admin-subsection-heading"><div><span className="koasis-admin-overline">Knowledge base</span><strong>Reference material untuk agent</strong><small>Konten ini hanya dikirim server ke agent aktif, tidak dibuka ke katalog publik.</small></div><button type="button" className="koasis-admin-secondary compact" onClick={() => onChange([...items, { id: `kb-${Date.now()}`, title: "Dokumen baru", content: "", enabled: true }])}><Plus size={14} />Tambah entry</button></div>{items.length === 0 && <div className="koasis-admin-empty-inline">Belum ada entry. Tambahkan guideline, SOP, atau batasan internal yang relevan.</div>}<div className="koasis-admin-kb-list">{items.map((item, index) => <div className="koasis-admin-kb-card" key={item.id}><div className="koasis-admin-kb-head"><span>Entry {index + 1}</span><label className="koasis-admin-inline-check"><input type="checkbox" checked={item.enabled} onChange={(event) => onChange(items.map((candidate) => candidate.id === item.id ? { ...candidate, enabled: event.target.checked } : candidate))} /> Aktif</label><button type="button" className="koasis-admin-icon-button danger" aria-label="Hapus knowledge entry" onClick={() => onChange(items.filter((candidate) => candidate.id !== item.id))}><X size={14} /></button></div><TextField label="Judul" value={item.title} onChange={(value) => onChange(items.map((candidate) => candidate.id === item.id ? { ...candidate, title: value } : candidate))} /><TextField label="Isi" value={item.content} onChange={(value) => onChange(items.map((candidate) => candidate.id === item.id ? { ...candidate, content: value } : candidate))} multiline /><TextField label="URL sumber (opsional)" value={item.sourceUrl || ""} onChange={(value) => onChange(items.map((candidate) => candidate.id === item.id ? { ...candidate, sourceUrl: value } : candidate))} /></div>)}</div></section>;
}

function AgentEditor({ config, selectedId, onSelect, onChange }: { config: AdminConfig; selectedId: string; onSelect: (id: string) => void; onChange: (next: AdminConfig) => void }) {
  const selected = config.agents.find((agent) => agent.id === selectedId) || config.agents[0];
  if (!selected) return null;
  const update = (patch: Partial<AdminAgentConfig>) => onChange({ ...config, agents: config.agents.map((agent) => agent.id === selected.id ? { ...agent, ...patch } : agent) });
  const rename = (value: string) => {
    const id = slugify(value) || selected.id;
    if (id === selected.id) {
      update({ id });
      return;
    }
    onChange({ ...config, defaultAgentId: config.defaultAgentId === selected.id ? id : config.defaultAgentId, agents: config.agents.map((agent) => agent.id === selected.id ? { ...agent, id } : agent) });
    onSelect(id);
  };
  const updatePersonalization = (patch: Partial<AdminAgentConfig["personalization"]>) => update({ personalization: { ...selected.personalization, ...patch } });
  const remove = () => {
    if (config.agents.length <= 1) return;
    const nextAgents = config.agents.filter((agent) => agent.id !== selected.id);
    onChange({ ...config, agents: nextAgents, defaultAgentId: config.defaultAgentId === selected.id ? nextAgents[0].id : config.defaultAgentId });
    onSelect(nextAgents[0].id);
  };
  return <div className="koasis-admin-section-grid">
    <aside className="koasis-admin-list-panel"><div className="koasis-admin-list-heading"><div><span className="koasis-admin-overline">Catalog</span><strong>{config.agents.length} specialist agent</strong></div><button type="button" className="koasis-admin-icon-button" aria-label="Tambah specialist agent" onClick={() => { const id = slugify(`agent-${config.agents.length + 1}`); onChange({ ...config, agents: [...config.agents, defaultCustomAgent(id)] }); onSelect(id); }}><Plus size={16} /></button></div><div className="koasis-admin-list">{config.agents.map((agent) => <button type="button" key={agent.id} className={selected.id === agent.id ? "active" : ""} onClick={() => onSelect(agent.id)}><span className={`koasis-admin-list-dot ${agent.enabled ? "on" : ""}`} /><span><strong>{agent.label}</strong><small>{agent.group} · {agent.sourcePolicy}</small></span><ChevronRight size={14} /></button>)}</div></aside>
    <section className="koasis-admin-editor"><div className="koasis-admin-editor-heading"><div><span className="koasis-admin-overline">Specialist configuration</span><h2>{selected.label}</h2><p>Semua perubahan di sini akan membentuk katalog dan kontrak agent di backend.</p></div><label className="koasis-admin-switch"><input type="checkbox" checked={selected.enabled} onChange={(event) => update({ enabled: event.target.checked })} /><span /><b>{selected.enabled ? "Tampil di katalog" : "Disembunyikan"}</b></label></div><div className="koasis-admin-form-grid"><TextField label="Agent key" value={selected.id} onChange={rename} placeholder="contoh: evidence" /><TextField label="Nama katalog" value={selected.label} onChange={(value) => update({ label: value })} /><TextField label="Deskripsi singkat" value={selected.shortDescription} onChange={(value) => update({ shortDescription: value })} /><TextField label="Tujuan agent" value={selected.purpose} onChange={(value) => update({ purpose: value })} multiline /><label className="koasis-admin-field"><span>Kelompok katalog</span><select value={selected.group} onChange={(event) => update({ group: event.target.value as AdminAgentConfig["group"] })}><option value="core">Core workspace</option><option value="clinical">Clinical work</option><option value="evidence">Evidence &amp; diagnosis</option><option value="documentation">Documentation</option></select></label><label className="koasis-admin-field"><span>Kebijakan sumber</span><select value={selected.sourcePolicy} onChange={(event) => update({ sourcePolicy: event.target.value as AdminAgentConfig["sourcePolicy"] })}><option value="workspace">Konteks workspace</option><option value="source-required">Sumber wajib</option><option value="rubric-required">Rubric wajib</option><option value="document-only">Fakta dari pengguna</option></select></label><TextField label="Risk label" value={selected.riskLabel} onChange={(value) => update({ riskLabel: value })} /><TextField label="Label sumber" value={selected.sourceLabel} onChange={(value) => update({ sourceLabel: value })} /><TextField label="Output contract (satu per baris)" value={selected.outputContract.join("\n")} onChange={(value) => update({ outputContract: value.split("\n").map((item) => item.trim()).filter(Boolean) })} multiline /><TextField label="Handoff description" value={selected.handoffDescription} onChange={(value) => update({ handoffDescription: value })} multiline /></div>
      <section className="koasis-admin-subsection"><div className="koasis-admin-subsection-heading"><div><span className="koasis-admin-overline">System prompt</span><strong>Instruksi inti specialist</strong><small>Instruksi ini menjadi kontrak server-side; jangan menaruh secret di sini.</small></div></div><textarea className="koasis-admin-prompt-editor" value={selected.systemPrompt} onChange={(event) => update({ systemPrompt: event.target.value })} /></section>
      <section className="koasis-admin-subsection"><div className="koasis-admin-subsection-heading"><div><span className="koasis-admin-overline">Personalization</span><strong>Gaya dan target agent</strong></div></div><div className="koasis-admin-form-grid"><TextField label="Tone" value={selected.personalization.tone} onChange={(value) => updatePersonalization({ tone: value })} /><TextField label="Response style" value={selected.personalization.responseStyle} onChange={(value) => updatePersonalization({ responseStyle: value })} /><TextField label="Target audience" value={selected.personalization.targetAudience} onChange={(value) => updatePersonalization({ targetAudience: value })} /><TextField label="Domain focus" value={selected.personalization.domainFocus} onChange={(value) => updatePersonalization({ domainFocus: value })} /><TextField label="Instruksi tambahan" value={selected.personalization.additionalInstructions} onChange={(value) => updatePersonalization({ additionalInstructions: value })} multiline /></div></section>
      <KnowledgeBaseEditor items={selected.knowledgeBase} onChange={(knowledgeBase) => update({ knowledgeBase })} />
      <label className="koasis-admin-default-check"><input type="radio" name="default-agent" checked={config.defaultAgentId === selected.id} onChange={() => onChange({ ...config, defaultAgentId: selected.id })} />Jadikan specialist agent default</label><div className="koasis-admin-danger-row"><button type="button" className="koasis-admin-danger" disabled={config.agents.length <= 1} onClick={remove}><Trash2 size={14} />Hapus dari katalog</button></div>
    </section>
  </div>;
}

export function AdminPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [session, setSession] = useState<AdminSession | null>(null);
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [tab, setTab] = useState<AdminTab>("models");
  const [selectedModelId, setSelectedModelId] = useState("elective");
  const [selectedAgentId, setSelectedAgentId] = useState("koasis");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const hydrate = async () => {
    setLoading(true);
    setError("");
    try {
      const nextSession = await loadAdminSession();
      setSession(nextSession);
      if (!nextSession.authenticated) {
        setAuthenticated(false);
        return;
      }
      const loaded = await loadAdminConfig();
      const nextConfig = sanitizeAdminConfig(loaded.config);
      setConfig(nextConfig);
      setSelectedModelId(nextConfig.models[0]?.id || "elective");
      setSelectedAgentId(nextConfig.agents[0]?.id || "koasis");
      setAuthenticated(true);
      setSession({ ...nextSession, persistenceConfigured: loaded.persistenceConfigured });
    } catch (hydrateError) {
      setError(hydrateError instanceof Error ? hydrateError.message : "Panel admin belum bisa dimuat.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void hydrate(); }, []);

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setNotice("");
    setError("");
    try {
      const result = await saveAdminConfig(config);
      setConfig(sanitizeAdminConfig(result.config));
      setSession((current) => current ? { ...current, persistenceConfigured: result.persistenceConfigured } : current);
      setNotice("Perubahan tersimpan. Backend AI dan katalog akan memakai konfigurasi ini.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Konfigurasi belum berhasil disimpan.");
    } finally {
      setSaving(false);
    }
  };

  const handleAuthenticated = (nextSession: AdminSession) => {
    setAuthenticated(true);
    setSession(nextSession);
    void hydrate();
  };

  const handleLogout = async () => {
    await logoutAdmin().catch(() => undefined);
    setAuthenticated(false);
    setConfig(null);
  };

  const selectedSummary = useMemo(() => tab === "models" ? `${config?.models.length || 0} route model` : `${config?.agents.length || 0} specialist`, [config, tab]);

  if (loading && !config) return <main className="koasis-admin-shell"><div className="koasis-admin-loading"><RefreshCw size={20} className="koasis-admin-spin" />Memuat panel admin…</div></main>;
  if (!authenticated || !config) return <AdminLogin onAuthenticated={handleAuthenticated} />;

  return <main className="koasis-admin-shell">
    <AdminHeader tab={tab} onTab={setTab} persistenceConfigured={Boolean(session?.persistenceConfigured)} onSave={() => void save()} saving={saving} onLogout={() => void handleLogout()} />
    <div className="koasis-admin-main"><section className="koasis-admin-intro"><div><span className="koasis-admin-overline">Koasis control plane</span><h1>Atur otak di balik workspace.</h1><p>Kelola model provider, katalog specialist agent, prompt sistem, personalisasi, dan knowledge base dari satu tempat.</p></div><div className="koasis-admin-summary"><span><Database size={14} />{session?.persistenceConfigured ? "Tersimpan di PostgreSQL" : "Mode fallback lokal"}</span><span><Check size={14} />{selectedSummary}</span></div></section>{(notice || error) && <div className={`koasis-admin-alert ${error ? "error" : "success"}`} role={error ? "alert" : "status"}>{error ? <CircleAlert size={15} /> : <Check size={15} />}{error || notice}<button type="button" aria-label="Tutup notifikasi" onClick={() => { setNotice(""); setError(""); }}><X size={14} /></button></div>}<section className="koasis-admin-workspace">{tab === "models" ? <ModelEditor config={config} selectedId={selectedModelId} onSelect={setSelectedModelId} onChange={setConfig} /> : <AgentEditor config={config} selectedId={selectedAgentId} onSelect={setSelectedAgentId} onChange={setConfig} />}</section></div>
  </main>;
}
